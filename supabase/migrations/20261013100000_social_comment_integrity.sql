-- Bucata 13 — Comment Thread Integrity & Moderation Consistency.
--
-- One rule for who a comment is shown to, applied everywhere a comment is
-- counted or listed: the thread, its replies, the preview under a feed card,
-- and the comment_count every feed-shaped read returns.
--
--   a comment is visible to the reader when its author is the reader, or is
--   listed for the reader (is_listed_user: not suspended, no deletion request,
--   no block either way) — and, for a reply, when its parent is visible too.
--
-- Mute is not part of it on purpose: mute quiets the feed and the stories
-- tray, it does not take someone out of a conversation you opened.
--
-- Mentions. A mention row is shown as a link only while it is still true:
-- the handle is in the current text (the same parser as the insert check,
-- social_mention_handles), the person is listed for the reader, may see the
-- post, and — for a comment — is not blocked with the comment's author. Rows
-- written before 20261012100000 are filtered on read, not deleted: suspension,
-- a block or a deletion request can be undone, and a deleted row cannot.
--
-- The one thing that never becomes true again is "the handle is no longer in
-- the text" after an edit. An edit therefore prunes exactly those rows, for
-- the edited row only — deterministic and idempotent (a second run finds
-- nothing), and a mention that is still in the text is never touched. A
-- mention that stays across an edit keeps its row, so it is never notified
-- twice; the notify triggers already dedupe per comment / per post as well.
--
-- Every function below starts from its last real definition (named on each).

-- ---------- 1. internal helpers (no EXECUTE for anyone but the owner) ----------

-- The author rule, in one place.
create or replace function public.social_author_visible(p_author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_author is not null and auth.uid() is not null
     and (p_author = auth.uid() or public.is_listed_user(p_author));
$$;

-- Replies under one top-level comment that the reader can see.
create or replace function public.social_visible_reply_count(p_parent uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.social_comments c
  where c.parent_id = p_parent
    and public.social_author_visible(c.user_id);
$$;

-- Every comment on a post that the reader can reach in the thread: a visible
-- top-level comment, or a visible reply under a visible top-level comment.
create or replace function public.social_visible_comment_count(p_post uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.social_comments c
  left join public.social_comments parent on parent.id = c.parent_id
  where c.post_id = p_post
    and public.social_author_visible(c.user_id)
    and (c.parent_id is null or public.social_author_visible(parent.user_id));
$$;

-- A post's mentions that are still true, in the order the text names them.
create or replace function public.social_visible_post_mentions(p_post uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username)
                            order by array_position(h.handles, lower(mu.username))), '[]'::jsonb)
  from public.social_posts p
  cross join lateral (select public.social_mention_handles(p.text) as handles) h
  join public.social_post_mentions m on m.post_id = p.id
  join public.users mu on mu.id = m.user_id
  where p.id = p_post
    and lower(mu.username) = any (h.handles)
    and public.is_listed_user(m.user_id)
    and public.user_can_see_post(m.user_id, p.id);
$$;

-- A comment's mentions that are still true, in the order the body names them.
create or replace function public.social_visible_comment_mentions(p_comment uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username)
                            order by array_position(h.handles, lower(mu.username))), '[]'::jsonb)
  from public.social_comments c
  cross join lateral (select public.social_mention_handles(c.body) as handles) h
  join public.social_comment_mentions m on m.comment_id = c.id
  join public.users mu on mu.id = m.user_id
  where c.id = p_comment
    and lower(mu.username) = any (h.handles)
    and public.is_listed_user(m.user_id)
    and public.user_can_see_post(m.user_id, c.post_id)
    and not public.social_blocked_between(c.user_id, m.user_id);
$$;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('social_author_visible', 'social_visible_reply_count', 'social_visible_comment_count',
                               'social_visible_post_mentions', 'social_visible_comment_mentions') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ---------- 2. an edit prunes the mentions its text no longer names ----------
create or replace function public.social_post_mentions_prune()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.text is distinct from old.text then
    delete from public.social_post_mentions m
    using public.users u
    where m.post_id = new.id and u.id = m.user_id
      and not coalesce(lower(u.username) = any (public.social_mention_handles(new.text)), false);
  end if;
  return null;
end;
$$;
revoke execute on function public.social_post_mentions_prune() from public, anon, authenticated;
drop trigger if exists social_posts_mentions_prune on public.social_posts;
create trigger social_posts_mentions_prune after update of text on public.social_posts
  for each row execute function public.social_post_mentions_prune();

create or replace function public.social_comment_mentions_prune()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.body is distinct from old.body then
    delete from public.social_comment_mentions m
    using public.users u
    where m.comment_id = new.id and u.id = m.user_id
      and not coalesce(lower(u.username) = any (public.social_mention_handles(new.body)), false);
  end if;
  return null;
end;
$$;
revoke execute on function public.social_comment_mentions_prune() from public, anon, authenticated;
drop trigger if exists social_comments_mentions_prune on public.social_comments;
create trigger social_comments_mentions_prune after update of body on public.social_comments
  for each row execute function public.social_comment_mentions_prune();

-- ---------- 3. the thread ----------
-- social_post_comments from 20261012100000: reply_count is the replies the reader can see.
create or replace function public.social_post_comments(
  p_post uuid,
  p_limit int default 20,
  p_before timestamptz default null
)
returns table (
  id uuid, parent_id uuid, user_id uuid, author_name text, author_username text,
  author_avatar text, body text, created_at timestamptz, edited_at timestamptz,
  mentions jsonb, reply_count int
) language sql stable security definer set search_path = public as $$
  with visible as (
    select 1 where public.can_see_post(p_post)
  ),
  roots as (
    select c.*
    from public.social_comments c, visible
    where c.post_id = p_post and c.parent_id is null
      and not public.social_blocked_between(auth.uid(), c.user_id)
      and (c.user_id = auth.uid() or public.is_listed_user(c.user_id))
      and (p_before is null or c.created_at < p_before)
    order by c.created_at desc, c.id desc
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ),
  threads as (
    select r.* from roots r
    union all
    select rep.* from roots r
    cross join lateral (
      select c.* from public.social_comments c
      where c.parent_id = r.id
        and not public.social_blocked_between(auth.uid(), c.user_id)
        and (c.user_id = auth.uid() or public.is_listed_user(c.user_id))
      order by c.created_at, c.id
      limit 3
    ) rep
  )
  select
    t.id, t.parent_id, t.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    t.body, t.created_at, t.edited_at,
    public.social_visible_comment_mentions(t.id),
    case when t.parent_id is null then public.social_visible_reply_count(t.id) else 0 end
  from threads t
  join public.users u on u.id = t.user_id
  order by coalesce(t.parent_id, t.id), (t.parent_id is not null), t.created_at;
$$;

-- social_comment_replies from 20261012100000: only under a top-level comment the reader can see.
create or replace function public.social_comment_replies(
  p_parent uuid,
  p_after timestamptz default null,
  p_limit int default 20
)
returns table (
  id uuid, parent_id uuid, user_id uuid, author_name text, author_username text,
  author_avatar text, body text, created_at timestamptz, edited_at timestamptz,
  mentions jsonb, reply_count int
) language sql stable security definer set search_path = public as $$
  select
    c.id, c.parent_id, c.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    c.body, c.created_at, c.edited_at,
    public.social_visible_comment_mentions(c.id),
    0
  from public.social_comments c
  join public.social_comments parent on parent.id = c.parent_id
  join public.users u on u.id = c.user_id
  where c.parent_id = p_parent
    and not public.social_blocked_between(auth.uid(), c.user_id)
    and (c.user_id = auth.uid() or public.is_listed_user(c.user_id))
    and public.can_see_post(parent.post_id)
    -- a reply under a comment the reader cannot see is unreachable, like the
    -- comment itself: the thread never shows it, so neither does paging
    and parent.parent_id is null
    and public.social_author_visible(parent.user_id)
    and (p_after is null or c.created_at > p_after)
  order by c.created_at, c.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- ---------- 4. the preview (from 20261006100000) ----------
-- The thread's author rule (your own comment included), so the two never disagree.
create or replace function public.social_comment_preview(p_post uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb)
  from (
    select c.id, c.created_at,
           jsonb_build_object(
             'id', c.id,
             'user_id', c.user_id,
             'author_name', coalesce(u.username, u.full_name),
             'author_avatar', u.avatar_url,
             'body', c.body,
             'created_at', c.created_at,
             'edited_at', c.edited_at,
             'mentions', public.social_visible_comment_mentions(c.id)
           ) as item
    from public.social_comments c
    join public.users u on u.id = c.user_id
    where auth.uid() is not null
      and public.can_see_post(p_post)
      and c.post_id = p_post
      and c.parent_id is null
      and public.social_author_visible(c.user_id)
    order by c.created_at desc, c.id desc
    limit 2
  ) x;
$$;

-- ---------- 5. comment_count and post mentions on every feed-shaped read ----------
-- social_feed, social_post, social_saved_posts from 20261007100000; social_shared_original from 20261005100000
create or replace function public.social_feed(
  p_limit int default 20,
  p_before timestamptz default null,
  p_author uuid default null,
  p_scope text default 'following',
  p_type text default null
)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, comment_preview jsonb, author_muted boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name) as author_name, u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    public.social_visible_comment_count(p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    public.social_visible_post_mentions(p.id),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    public.social_comment_preview(p.id),
    public.social_is_muted(p.user_id)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where auth.uid() is not null
    and p.deleted_at is null
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id))
    -- Muted: gone from the feed, still on their own profile (p_author).
    and (p_author is not null or not public.social_is_muted(p.user_id))
    and (p_before is null or p.created_at < p_before)
    and (p_type is null or p.type = p_type)
    and (
      case
        when p_author is not null then p.user_id = p_author
        when coalesce(p_scope, 'following') = 'mine' then p.user_id = auth.uid()
        when coalesce(p_scope, 'following') = 'all' then true
        else (p.user_id = auth.uid() or public.is_following(p.user_id))
      end
    )
    and (
      p.user_id = auth.uid()
      or p.visibility = 'public'
      or (p.visibility = 'followers'
          and (public.is_following(p.user_id) or public.is_active_coach_of(p.user_id)))
    )
  order by p.created_at desc, p.id desc
  limit greatest(1, least(p_limit, 50));
$$;

create or replace function public.social_post(p_post uuid)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, author_muted boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    public.social_visible_comment_count(p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    public.social_visible_post_mentions(p.id),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    public.social_is_muted(p.user_id)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and auth.uid() is not null and p.deleted_at is null and public.can_see_post(p.id)
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id));
$$;

create or replace function public.social_saved_posts(p_limit int default 20, p_before timestamptz default null)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, saved_at timestamptz, comment_preview jsonb, author_muted boolean
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    public.social_visible_comment_count(p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    public.social_visible_post_mentions(p.id),
    p.edited_at,
    true,
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    sv.created_at,
    public.social_comment_preview(p.id),
    public.social_is_muted(p.user_id)
  from public.social_post_saves sv
  join public.social_posts p on p.id = sv.post_id
  join public.users u on u.id = p.user_id
  where auth.uid() is not null
    and sv.user_id = auth.uid()
    and p.deleted_at is null
    and public.can_see_post(p.id)
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id))
    and (p_before is null or sv.created_at < p_before)
  order by sv.created_at desc, p.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create or replace function public.social_shared_original(p_payload jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'user_id', o.user_id,
    'author_name', coalesce(ou.username, ou.full_name), 'author_avatar', ou.avatar_url,
    'type', o.type, 'text', o.text, 'payload', o.payload, 'visibility', o.visibility,
    'created_at', o.created_at,
    'mentions', public.social_visible_post_mentions(o.id))
  from public.social_posts o
  join public.users ou on ou.id = o.user_id
  where p_payload ->> 'kind' = 'shared_post'
    and o.id = (p_payload ->> 'original_post_id')::uuid
    and auth.uid() is not null
    and public.can_see_post(o.id)
    and public.is_listed_user(o.user_id);
$$;

-- The grants these functions already had are kept by create or replace;
-- restated so anon is refused whatever the default privileges are.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('social_feed', 'social_post', 'social_saved_posts', 'social_shared_original',
                               'social_comment_preview', 'social_post_comments', 'social_comment_replies') loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
