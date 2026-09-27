-- Social 2.0 · Comment preview in the feed
--
-- Up to two comments under each post in the feed, carried inside the feed's
-- own result — so a page of 20 posts is still ONE round trip, never a request
-- per card or per comment.
--
-- social_comment_preview(post) is the one rule:
--   · the same order as the thread itself (social_post_comments): top-level
--     comments, newest first, id as the tie-break — replies stay in the thread;
--   · at most two, straight off social_comments_post_idx;
--   · only for a caller with a session who may see the post — can_see_post(),
--     exactly what comments_select (RLS) asks, so calling it directly on a
--     post you cannot see returns an empty list, never a bypass;
--   · never a comment by an account that is suspended or being deleted
--     (is_listed_user, the rule of every social surface since 20261003100000).
-- Only what the preview shows travels: id, author id, name, avatar, body,
-- created_at, edited_at, and the resolved mentions MentionText needs.
--
-- The total under it is the existing comment_count (a server-side count(*)
-- of every comment on the post, replies included) — unchanged, and never
-- derived from the two in the preview.
--
-- social_feed and social_saved_posts gain the column `comment_preview`; their
-- bodies are 20261005100000's otherwise. social_post (one post's page) shows
-- the whole thread and does not need it.
--
-- Depends on 20261003100000 (is_listed_user) and 20261005100000.

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
             'mentions', coalesce((
               select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
               from public.social_comment_mentions m join public.users mu on mu.id = m.user_id
               where m.comment_id = c.id
             ), '[]'::jsonb)
           ) as item
    from public.social_comments c
    join public.users u on u.id = c.user_id
    where auth.uid() is not null
      and public.can_see_post(p_post)
      and c.post_id = p_post
      and c.parent_id is null
      and public.is_listed_user(c.user_id)
    order by c.created_at desc, c.id desc
    limit 2
  ) x;
$$;
revoke execute on function public.social_comment_preview(uuid) from public, anon;
grant execute on function public.social_comment_preview(uuid) to authenticated;

drop function if exists public.social_feed(int, timestamptz, uuid, text, text);
create function public.social_feed(
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
  edited_at timestamptz, saved boolean, shared jsonb, comment_preview jsonb
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name) as author_name, u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    public.social_comment_preview(p.id)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where auth.uid() is not null
    and p.deleted_at is null
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id))
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
revoke execute on function public.social_feed(int, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.social_feed(int, timestamptz, uuid, text, text) to authenticated;

drop function if exists public.social_saved_posts(int, timestamptz);
create function public.social_saved_posts(p_limit int default 20, p_before timestamptz default null)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz, saved boolean, shared jsonb, saved_at timestamptz, comment_preview jsonb
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id),
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
    p.edited_at,
    true,
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    sv.created_at,
    public.social_comment_preview(p.id)
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
revoke execute on function public.social_saved_posts(int, timestamptz) from public, anon;
grant execute on function public.social_saved_posts(int, timestamptz) to authenticated;
