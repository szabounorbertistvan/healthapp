-- Notification snippets follow the thread's own visibility rule (QA BUG-16).
--
-- social_notification_feed() (20261008100000) rebuilt a comment row's snippet
-- from the live comment, but only asked can_see_post() — "may the reader see
-- the POST". The reader always may see their own post, so after a block the
-- blocked person's comment text still came back on the old notification
-- ("QA comment B1"), with the author already anonymized to "Someone" while
-- the comment itself was hidden from the post's thread.
--
-- The snippet now asks exactly what the thread asks (social_post_comments,
-- social_visible_comment_count in 20261013100000):
--   * the comment's author is visible to the reader — social_author_visible:
--     the reader themself, or is_listed_user (not suspended, not being
--     deleted, no block in either direction). That is the same predicate the
--     actor join below uses to anonymize the name, so a row whose actor reads
--     as "Someone" can no longer carry that person's words;
--   * a reply's parent author is visible too (a reply under a hidden comment
--     is hidden with it);
--   * the post still exists (deleted_at is null) and the reader may see it.
-- A caption mention gets the same author check on the post's author.
--
-- It also closes a fall-through: a legacy new_comment / comment_reply row
-- without a comment_id used to drop to `else n.body`, i.e. the text stored
-- when the row was written. Those now have no snippet, like a follow.
--
-- Signature, grants and every other column are unchanged; `body` itself is
-- still untouched (push-dispatch sends it at write time, when the trigger's
-- social_notify_ok already refused a blocked pair).

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
      -- and only while the thread itself would show it to the reader
      when n.category::text in ('new_comment', 'comment_reply', 'new_mention') and n.payload ? 'comment_id' then (
        select left(c.body, 140)
        from public.social_comments c
        join public.social_posts p on p.id = c.post_id
        left join public.social_comments parent on parent.id = c.parent_id
        where c.id = public.social_try_uuid(n.payload ->> 'comment_id')
          and p.deleted_at is null
          and public.can_see_post(c.post_id)
          and public.social_author_visible(c.user_id)
          and (c.parent_id is null or public.social_author_visible(parent.user_id))
      )
      -- a legacy comment row with no comment id: nothing live to show
      when n.category::text in ('new_comment', 'comment_reply') then null
      -- a mention in a caption: the caption as it is now, same conditions
      when n.category::text = 'new_mention' then (
        select left(p.text, 140) from public.social_posts p
        where p.id = public.social_try_uuid(n.payload ->> 'post_id')
          and p.deleted_at is null
          and public.can_see_post(p.id)
          and public.social_author_visible(p.user_id)
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
