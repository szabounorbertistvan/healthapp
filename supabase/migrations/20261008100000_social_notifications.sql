-- Social 2.0 · Notifications & Activity Center
--
-- The notification system already covers every social event (follow, Kudos,
-- comment, reply, mention in a post, mention in a comment, badge) with
-- per-event dedupe. This migration tightens it rather than rebuilding it.
--
-- 1. A notification is written, read and marked read, and nothing else:
--    authenticated keeps UPDATE on read_at only. Until now the table-level
--    UPDATE grant let a person rewrite the payload, title or category of
--    their own rows (RLS kept it to their own, but not to read_at).
--
-- 2. One rule for "may this social event notify this person"
--    (social_notify_ok): not yourself, not an account that is suspended or
--    being deleted, and never across a block in either direction. Every
--    social trigger now asks it:
--      notify_new_kudos     — was: self only
--      notify_new_follower  — was: nothing (follows across a block are
--                             already refused by follows_insert since
--                             20261007100000; this is the second lock)
--      notify_new_comment   — the reply branch also asks whether the parent
--                             comment's author may still see the post: a
--                             reply is not a way to reach someone who cannot
--      notify_new_mention   — the inline visibility copy is replaced by
--                             user_can_see_post(), which knows about blocks
--      notify_post_mention  — was: visibility only
--    Dedupe rules are unchanged: one follow notice per pair ever, one Kudos
--    notice per (post, giver) ever — taking Kudos back and giving it again
--    does not ping twice, and the notice stays when Kudos is withdrawn — one
--    mention notice per comment, one per post.
--
-- 3. social_notification_feed(): the Activity Center's read, one round trip.
--    The rows, their actor (name/avatar), and a snippet rebuilt from the
--    live comment or caption — never the copy stored in `body` when the row
--    was written. So a comment that was deleted, or a post the reader can no
--    longer see, shows no text at all: a notification is not a side door to
--    content. An actor who is now hidden from the reader (block, suspension,
--    deletion) comes back without name or face; the row stays, as history.
--    `body` itself is untouched — push-dispatch still sends it.
--
-- Depends on 20261007100000 (social_blocked_between, block-aware
-- user_can_see_post / is_listed_user).

-- ---------- 1. read_at is the only writable column ----------
revoke update on table public.notifications from authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- ---------- 2. who may be notified ----------
create or replace function public.social_notify_ok(p_recipient uuid, p_actor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_recipient is not null
     and p_recipient is distinct from p_actor
     and exists (select 1 from public.users u where u.id = p_recipient and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id = p_recipient)
     and not public.social_blocked_between(p_recipient, p_actor);
$$;
revoke execute on function public.social_notify_ok(uuid, uuid) from public, anon, authenticated;

-- Kudos: 20260913120000's body plus the rule.
create or replace function public.notify_new_kudos()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
  v_giver text;
begin
  select p.user_id into v_author from public.social_posts p where p.id = new.post_id;
  if v_author is null or not public.social_notify_ok(v_author, new.user_id) then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_author and n.category = 'new_kudos'
      and n.payload ->> 'post_id' = new.post_id::text
      and n.payload ->> 'actor_id' = new.user_id::text
  ) then
    return new;
  end if;
  select coalesce(u.username, u.full_name, 'Someone') into v_giver from public.users u where u.id = new.user_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (v_author, 'new_kudos', 'New kudos', v_giver || ' gave you kudos',
          jsonb_build_object('post_id', new.post_id, 'actor_id', new.user_id));
  return new;
end;
$$;

-- Follow: 20260914130000's body plus the rule.
create or replace function public.notify_new_follower()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.social_notify_ok(new.following_id, new.follower_id) then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.following_id and n.category = 'new_follower'
      and n.payload ->> 'follower_id' = new.follower_id::text
  ) then
    return new;
  end if;
  select coalesce(u.username, u.full_name, 'Someone') into v_name from public.users u where u.id = new.follower_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (new.following_id, 'new_follower', 'New follower', v_name || ' started following you',
          jsonb_build_object('follower_id', new.follower_id));
  return new;
end;
$$;

-- Comment and reply: 20260930110000's body plus the rule, and the reply
-- recipient must still be able to see the post.
create or replace function public.notify_new_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text;
  v_post public.social_posts;
  v_parent_author uuid;
  v_told uuid[] := '{}';
begin
  select coalesce(u.username, u.full_name) into v_actor from public.users u where u.id = new.user_id;
  select * into v_post from public.social_posts where id = new.post_id;
  if not found or v_post.deleted_at is not null then
    return new;
  end if;

  if new.parent_id is not null then
    select c.user_id into v_parent_author from public.social_comments c where c.id = new.parent_id;
    if v_parent_author is not null
       and public.social_notify_ok(v_parent_author, new.user_id)
       and public.user_can_see_post(v_parent_author, new.post_id) then
      insert into public.notifications (user_id, category, title, body, payload)
      values (v_parent_author, 'comment_reply', v_actor, left(new.body, 140),
              jsonb_build_object('post_id', new.post_id, 'comment_id', new.id, 'actor_id', new.user_id));
      v_told := array_append(v_told, v_parent_author);
    end if;
  end if;

  if public.social_notify_ok(v_post.user_id, new.user_id) and not (v_post.user_id = any(v_told)) then
    insert into public.notifications (user_id, category, title, body, payload)
    values (v_post.user_id, 'new_comment', v_actor, left(new.body, 140),
            jsonb_build_object('post_id', new.post_id, 'comment_id', new.id, 'actor_id', new.user_id));
  end if;

  return new;
end;
$$;

-- Mention in a comment: 20260930110000's body with its inline visibility copy
-- replaced by user_can_see_post() (block-aware), plus the rule.
create or replace function public.notify_new_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_comment public.social_comments;
  v_actor text;
begin
  select * into v_comment from public.social_comments where id = new.comment_id;
  if not found
     or not public.social_notify_ok(new.user_id, v_comment.user_id)
     or not public.user_can_see_post(new.user_id, v_comment.post_id) then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.user_id
      and n.payload ->> 'comment_id' = new.comment_id::text
  ) then
    return new;
  end if;
  select coalesce(u.username, u.full_name) into v_actor from public.users u where u.id = v_comment.user_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (new.user_id, 'new_mention', v_actor, left(v_comment.body, 140),
          jsonb_build_object('post_id', v_comment.post_id, 'comment_id', v_comment.id, 'actor_id', v_comment.user_id));
  return new;
end;
$$;

-- Mention in a post: 20260930120000's body plus the rule.
create or replace function public.notify_post_mention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_post public.social_posts;
  v_actor text;
begin
  select * into v_post from public.social_posts where id = new.post_id;
  if not found
     or not public.social_notify_ok(new.user_id, v_post.user_id)
     or not public.user_can_see_post(new.user_id, new.post_id) then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = new.user_id and n.category = 'new_mention'
      and n.payload ->> 'post_id' = new.post_id::text
      and not (n.payload ? 'comment_id')
  ) then
    return new;
  end if;
  select coalesce(u.username, u.full_name) into v_actor from public.users u where u.id = v_post.user_id;
  insert into public.notifications (user_id, category, title, body, payload)
  values (new.user_id, 'new_mention', v_actor, left(coalesce(v_post.text, ''), 140),
          jsonb_build_object('post_id', v_post.id, 'actor_id', v_post.user_id));
  return new;
end;
$$;

-- ---------- 3. the Activity Center's read ----------
-- A payload id as a uuid, or null — never an error. One malformed legacy row
-- must not take the whole Activity Center down with a cast failure.
create or replace function public.social_try_uuid(p text)
returns uuid language sql immutable set search_path = public as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

create or replace function public.social_notification_feed(
  p_limit int default 20,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_unread_only boolean default false
)
returns table (
  id uuid, category text, title text, snippet text, payload jsonb,
  created_at timestamptz, read_at timestamptz,
  actor_id uuid, actor_name text, actor_username text, actor_avatar text
)
language sql stable security definer set search_path = public as $$
  select
    n.id, n.category::text, n.title,
    case
      -- a comment, a reply, a mention in a comment: the comment as it is now,
      -- and only while the reader may see its post
      when n.category::text in ('new_comment', 'comment_reply', 'new_mention') and n.payload ? 'comment_id' then (
        select left(c.body, 140) from public.social_comments c
        where c.id = public.social_try_uuid(n.payload ->> 'comment_id') and public.can_see_post(c.post_id)
      )
      -- a mention in a caption: the caption as it is now, same condition
      when n.category::text = 'new_mention' then (
        select left(p.text, 140) from public.social_posts p
        where p.id = public.social_try_uuid(n.payload ->> 'post_id') and public.can_see_post(p.id)
      )
      -- a follow or Kudos has no text; everything else (badges, challenges,
      -- the engine's reminders) keeps the text it was written with
      when n.category::text in ('new_follower', 'new_kudos') then null
      else n.body
    end,
    n.payload, n.created_at, n.read_at,
    a.id, a.name, a.username, a.avatar_url
  from public.notifications n
  left join lateral (
    select u.id, coalesce(u.username, u.full_name) as name, u.username, u.avatar_url
    from public.users u
    where u.id = coalesce(public.social_try_uuid(n.payload ->> 'actor_id'), public.social_try_uuid(n.payload ->> 'follower_id'))
      and public.is_listed_user(u.id)
  ) a on true
  where auth.uid() is not null
    and n.user_id = auth.uid()
    and (not coalesce(p_unread_only, false) or n.read_at is null)
    and (p_before_at is null
         or n.created_at < p_before_at
         or (n.created_at = p_before_at and p_before_id is not null and n.id < p_before_id))
  order by n.created_at desc, n.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 51));
$$;
revoke execute on function public.social_notification_feed(int, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.social_notification_feed(int, timestamptz, uuid, boolean) to authenticated;
