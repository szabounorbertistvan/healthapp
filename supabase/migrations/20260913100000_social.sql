-- HealthApp schema · social feed
--
-- Follows, posts, kudos and comments — a fitness feed in the Strava mould:
-- what someone chose to publish about a workout, a PR, a finished challenge
-- or their progress, plus plain text. Two design rules carry the privacy:
--
-- 1. A post never points the reader at private data. `payload` is a jsonb
--    SNAPSHOT the author's own server action wrote from rows they own —
--    aggregates for a workout (name, duration, exercise/set counts, volume,
--    training load), one lift for a PR, title + target for a challenge. The
--    feed is served from that snapshot alone; nothing joins logged_sets,
--    food_logs or measurements. Body weight can appear only in a `progress`
--    post and only because the author typed it in.
--
-- 2. users_select shows a person only themselves and their coach / clients,
--    so the feed cannot read authors' names through the table. social_feed()
--    and friends are security definer for exactly that: they return name,
--    username and avatar for the authors of posts the caller may see, and
--    nothing else about them.
--
-- Visibility: public (anyone signed in), followers (people who follow the
-- author), private (the author). The home feed shows own posts and those of
-- people you follow; public discovery is a later step and needs no schema.

create table public.social_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.users (id) on delete cascade,
  following_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);
create index social_follows_following_idx on public.social_follows (following_id);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('workout', 'pr', 'challenge_completed', 'progress', 'text')),
  text text check (text is null or char_length(text) <= 500),
  -- the session a workout / pr post came from; keeps "share once" honest
  activity_id uuid references public.logged_sessions (id) on delete set null,
  challenge_id uuid references public.challenges (id) on delete set null,
  -- the published snapshot (see header); null for a plain text post
  payload jsonb,
  visibility text not null default 'followers' check (visibility in ('public', 'followers', 'private')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index social_posts_user_idx on public.social_posts (user_id, created_at desc) where deleted_at is null;
create index social_posts_feed_idx on public.social_posts (created_at desc) where deleted_at is null;
-- one workout post per session, one completion post per challenge
create unique index social_posts_one_per_session on public.social_posts (user_id, activity_id)
  where type = 'workout' and activity_id is not null and deleted_at is null;
create unique index social_posts_one_per_challenge on public.social_posts (user_id, challenge_id)
  where type = 'challenge_completed' and challenge_id is not null and deleted_at is null;

create table public.social_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null default 'kudos' check (type in ('kudos')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id, type)
);

create table public.social_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index social_comments_post_idx on public.social_comments (post_id, created_at);
create trigger social_comments_updated before update on public.social_comments
  for each row execute function public.handle_updated_at();

-- ---------- helpers ----------
create or replace function public.is_following(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_follows where follower_id = auth.uid() and following_id = p_user
  );
$$;

/** The one visibility rule; every policy and RPC below goes through it. */
create or replace function public.can_see_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post
      and p.deleted_at is null
      and (
        p.user_id = auth.uid()
        or p.visibility = 'public'
        or (p.visibility = 'followers' and public.is_following(p.user_id))
      )
  );
$$;

-- ---------- RLS ----------
alter table public.social_follows   enable row level security;
alter table public.social_posts     enable row level security;
alter table public.social_reactions enable row level security;
alter table public.social_comments  enable row level security;

-- follows: you see the edges you are on; you create and remove only your own
create policy follows_select on public.social_follows for select to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());
create policy follows_insert on public.social_follows for insert to authenticated
  with check (follower_id = auth.uid());
create policy follows_delete on public.social_follows for delete to authenticated
  using (follower_id = auth.uid());

-- posts: visibility rule for reads; only your own for writes
create policy posts_select on public.social_posts for select to authenticated
  using (public.can_see_post(id));
create policy posts_insert on public.social_posts for insert to authenticated
  with check (user_id = auth.uid());
create policy posts_update on public.social_posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy posts_delete on public.social_posts for delete to authenticated
  using (user_id = auth.uid());

-- reactions / comments: readable wherever the post is; written only as yourself
create policy reactions_select on public.social_reactions for select to authenticated
  using (public.can_see_post(post_id));
create policy reactions_insert on public.social_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_post(post_id));
create policy reactions_delete on public.social_reactions for delete to authenticated
  using (user_id = auth.uid());

create policy comments_select on public.social_comments for select to authenticated
  using (public.can_see_post(post_id));
create policy comments_insert on public.social_comments for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_post(post_id));
create policy comments_update on public.social_comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy comments_delete on public.social_comments for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on table public.social_follows to authenticated;
grant select, insert, update, delete on table public.social_posts to authenticated;
grant select, insert, delete on table public.social_reactions to authenticated;
grant select, insert, update, delete on table public.social_comments to authenticated;
grant execute on function public.is_following(uuid), public.can_see_post(uuid) to authenticated;

-- ---------- feed ----------
-- One page of the home feed (own + followed), newest first, with the author
-- and the counts folded in — one round trip, no per-post lookups.
create or replace function public.social_feed(p_limit int default 20, p_before timestamptz default null, p_author uuid default null)
returns table (
  id uuid, user_id uuid, author_name text, author_username text, author_avatar text,
  type text, text text, payload jsonb, visibility text, created_at timestamptz,
  activity_id uuid, challenge_id uuid,
  kudos_count int, comment_count int, my_kudos boolean, kudos_first text
) language sql stable security definer set search_path = public as $$
  select
    p.id, p.user_id,
    coalesce(u.username, u.full_name) as author_name, u.username, u.avatar_url,
    p.type, p.text, p.payload, p.visibility, p.created_at,
    p.activity_id, p.challenge_id,
    (select count(*)::int from public.social_reactions r where r.post_id = p.id) as kudos_count,
    (select count(*)::int from public.social_comments c where c.post_id = p.id) as comment_count,
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()) as my_kudos,
    (select coalesce(ru.username, ru.full_name) from public.social_reactions r
       join public.users ru on ru.id = r.user_id
      where r.post_id = p.id order by r.created_at limit 1) as kudos_first
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and (p_before is null or p.created_at < p_before)
    and (
      -- home feed: mine + people I follow; profile feed: one author
      case when p_author is null
           then (p.user_id = auth.uid() or public.is_following(p.user_id))
           else p.user_id = p_author end
    )
    and (
      p.user_id = auth.uid()
      or p.visibility = 'public'
      or (p.visibility = 'followers' and public.is_following(p.user_id))
    )
  order by p.created_at desc, p.id desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.social_feed(int, timestamptz, uuid) to authenticated;

create or replace function public.social_post_comments(p_post uuid)
returns table (id uuid, user_id uuid, author_name text, author_avatar text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.user_id, coalesce(u.username, u.full_name), u.avatar_url, c.body, c.created_at
  from public.social_comments c
  join public.users u on u.id = c.user_id
  where c.post_id = p_post and public.can_see_post(p_post)
  order by c.created_at;
$$;
grant execute on function public.social_post_comments(uuid) to authenticated;

-- The public face of a person: name, follow counts, and three aggregate
-- numbers. Deliberately nothing else — no weight, no nutrition, no sets.
create or replace function public.social_profile(p_user uuid)
returns table (
  id uuid, name text, username text, avatar_url text,
  followers int, following int, workouts int, prs int, challenges int,
  is_following boolean, follows_me boolean
) language sql stable security definer set search_path = public as $$
  select
    u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
    (select count(*)::int from public.social_follows f where f.following_id = u.id),
    (select count(*)::int from public.social_follows f where f.follower_id = u.id),
    (select count(*)::int from public.logged_sessions s where s.user_id = u.id and s.completed_at is not null),
    (select count(*)::int from public.logged_sets ls where ls.user_id = u.id and ls.is_pr),
    (select count(*)::int from public.challenge_participants cp where cp.user_id = u.id and cp.completed_at is not null),
    public.is_following(u.id),
    exists (select 1 from public.social_follows f where f.follower_id = u.id and f.following_id = auth.uid())
  from public.users u
  where u.id = p_user;
$$;
grant execute on function public.social_profile(uuid) to authenticated;

-- Find people by username or name (prefix / substring, case-insensitive).
create or replace function public.social_search_users(p_query text)
returns table (id uuid, name text, username text, avatar_url text, is_following boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, public.is_following(u.id)
  from public.users u
  where u.id <> auth.uid()
    and char_length(trim(p_query)) >= 2
    and (u.username ilike '%' || trim(p_query) || '%' or u.full_name ilike '%' || trim(p_query) || '%')
  order by (u.username ilike trim(p_query) || '%') desc, u.username nulls last
  limit 20;
$$;
grant execute on function public.social_search_users(text) to authenticated;

-- ---------- notifications (prepared, not wired) ----------
-- The engine enqueues notifications with the service role; nothing here
-- writes them yet. The categories exist so a later job can.
alter type public.notification_category add value if not exists 'new_kudos';
alter type public.notification_category add value if not exists 'new_comment';
alter type public.notification_category add value if not exists 'new_follower';
