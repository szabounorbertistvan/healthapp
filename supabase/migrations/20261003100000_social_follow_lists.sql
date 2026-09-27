-- Social 2.0 · part 3: followers / following, and who the social surfaces show
--
-- 1. is_listed_user(): the one rule for "may appear on a social surface" —
--    not suspended by an admin and not queued for deletion. People search and
--    suggestions already applied exactly this inline (20260930120000); the
--    follow lists, the profile, mutual followers, the feed and a single post
--    did not, so a suspended or deleting account stayed visible there.
-- 2. social_follow_list() gains a server-side search (username, and a display
--    name that is not an e-mail address) and `follows_me`, so a row can say
--    "Follows you" without a second request. Cursor paging is unchanged.
-- 3. social_profile() hides an unlisted person from everyone but themselves,
--    and its follower / following counts count only listed people — the same
--    people the lists show, so a count never promises rows that are not there.
-- 4. social_mutual_followers(), social_feed() and social_post(): the same
--    filter, nothing else changed. Each body below is the latest definition
--    (20260930110000 / 20260930120000 / 20260930130000) with that one clause
--    added; the return shapes are the same, so `create or replace` suffices
--    everywhere except social_follow_list, whose signature grows.
--
-- Unchanged on purpose: follow / unfollow themselves, the unique pair and the
-- no-self check on social_follows, its owner-only policies, and the
-- once-per-pair new_follower notification (20260914130000).

-- ---------- 1. the rule ----------
create or replace function public.is_listed_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = p_user and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id = p_user);
$$;
-- Whether someone is suspended is not public knowledge: signed-in callers only,
-- and in practice only the functions below ask.
revoke execute on function public.is_listed_user(uuid) from public, anon;
grant execute on function public.is_listed_user(uuid) to authenticated;

-- ---------- 2. the follow lists ----------
drop function if exists public.social_follow_list(uuid, text, int, timestamptz);
create function public.social_follow_list(
  p_user uuid,
  p_which text,
  p_limit int default 20,
  p_before timestamptz default null,
  p_query text default null
)
returns table (
  id uuid, name text, username text, avatar_url text,
  is_following boolean, follows_me boolean, followed_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  -- The search term with LIKE's own wildcards escaped, so "_" matches "_".
  v_q text := nullif(replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_'), '');
begin
  if p_which not in ('followers', 'following') then
    raise exception 'unknown list' using errcode = '22023';
  end if;
  if auth.uid() is null then return; end if;
  -- An unlisted person's lists are as gone as their profile — except to themselves.
  if p_user <> auth.uid() and not public.is_listed_user(p_user) then return; end if;
  return query
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
         public.is_following(u.id),
         exists (select 1 from public.social_follows back
                 where back.follower_id = u.id and back.following_id = auth.uid()),
         f.created_at
  from public.social_follows f
  join public.users u on u.id = (case when p_which = 'followers' then f.follower_id else f.following_id end)
  where (case when p_which = 'followers' then f.following_id else f.follower_id end) = p_user
    and u.suspended_at is null
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)
    and (p_before is null or f.created_at < p_before)
    -- full_name falls back to the e-mail address at sign-up; a list search
    -- must not become a way to test whether someone's address contains "x".
    and (v_q is null
         or u.username ilike '%' || v_q || '%'
         or (u.full_name not like '%@%' and u.full_name ilike '%' || v_q || '%'))
  order by f.created_at desc, f.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;
grant execute on function public.social_follow_list(uuid, text, int, timestamptz, text) to authenticated;

-- ---------- 3. the profile ----------
create or replace function public.social_profile(p_user uuid)
returns table (
  id uuid, name text, username text, avatar_url text, city text, bio text,
  followers int, following int, posts int,
  stats_visible boolean,
  workouts int, prs int, challenges int, streak_days int, longest_streak int, badges int,
  fitness_score int, fitness_score_at timestamptz,
  is_following boolean, follows_me boolean,
  stats_visibility text, fitness_score_visibility text
) language sql stable security definer set search_path = public as $$
  select
    u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city, u.bio,
    (select count(*)::int from public.social_follows f
      where f.following_id = u.id and public.is_listed_user(f.follower_id)),
    (select count(*)::int from public.social_follows f
      where f.follower_id = u.id and public.is_listed_user(f.following_id)),
    (select count(*)::int from public.social_posts p
      where p.user_id = u.id and p.deleted_at is null and public.can_see_post(p.id)),
    v.ok,
    case when v.ok then (select count(*)::int from public.logged_sessions s where s.user_id = u.id and s.completed_at is not null) end,
    case when v.ok then (select count(*)::int from public.logged_sets ls where ls.user_id = u.id and ls.is_pr) end,
    case when v.ok then (select count(*)::int from public.challenge_participants cp where cp.user_id = u.id and cp.completed_at is not null) end,
    case when v.ok then st.current_days end,
    case when v.ok then st.longest_days end,
    case when v.ok then (select count(*)::int from public.user_badges ub where ub.user_id = u.id) end,
    case when public.can_see_fitness_score(u.id) then u.fitness_score_public::int end,
    case when public.can_see_fitness_score(u.id) then u.fitness_score_public_at end,
    public.is_following(u.id),
    exists (select 1 from public.social_follows f where f.follower_id = u.id and f.following_id = auth.uid()),
    case when u.id = auth.uid() then u.stats_visibility end,
    case when u.id = auth.uid() then u.fitness_score_visibility end
  from public.users u
  cross join lateral (select public.can_see_stats(u.id) as ok) v
  left join lateral public.social_streak(u.id) st on true
  where u.id = p_user
    and auth.uid() is not null
    and (u.id = auth.uid() or public.is_listed_user(u.id));
$$;

-- ---------- 4. mutual followers, the feed, one post ----------
create or replace function public.social_mutual_followers(p_user uuid, p_limit int default 3)
returns table (id uuid, name text, username text, avatar_url text, total int)
language sql stable security definer set search_path = public as $$
  with mutual as (
    select f.follower_id as id
    from public.social_follows f
    where f.following_id = p_user
      and f.follower_id <> auth.uid()
      and public.is_listed_user(f.follower_id)
      and exists (select 1 from public.social_follows mine
                  where mine.follower_id = auth.uid() and mine.following_id = f.follower_id)
  )
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
         (select count(*)::int from mutual)
  from mutual m
  join public.users u on u.id = m.id
  order by u.username nulls last
  limit greatest(1, least(coalesce(p_limit, 3), 20));
$$;

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
  edited_at timestamptz
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
    p.edited_at
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
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

create or replace function public.social_post(p_post uuid)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_names text[], mentions jsonb,
  edited_at timestamptz
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
    p.edited_at
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and p.deleted_at is null and public.can_see_post(p.id)
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id));
$$;
