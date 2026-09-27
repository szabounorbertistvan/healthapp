-- Social 2.0 · Report / Mute / Block
--
-- Personal controls, not a moderation system: no review queue, no bans, no
-- statuses. Three tables and one idea — hide, don't delete.
--
-- BLOCK is between two people and works both ways, the way people expect a
-- block to: once A blocks B, neither sees the other's posts, stories,
-- comments, kudos, profile or place in any list, and neither can follow,
-- comment on or give kudos to the other. The follow edges between them are
-- removed in the same statement that writes the block. Unblocking restores
-- visibility and nothing else — never the follows. The one thing the blocker
-- keeps is the blocked person's profile page (empty), so there is somewhere
-- to unblock from. Nobody is told; nothing is written to notifications.
--
-- How it reaches everything without a rewrite: every social surface already
-- asks one of three questions — can_see_post (posts, and through it comments,
-- kudos, saves, shares), user_can_see_post (shares, mention notifications),
-- is_listed_user (people, profiles, stories, comment preview, kudos names).
-- Each now also asks "is there a block between these two?". The few RPCs
-- that filter people inline instead get the same clause, one line each.
--
-- MUTE is one-way and quiet: the muted person's posts leave the muter's home
-- feed and their stories leave the muter's tray. Their profile, their posts
-- on it, and every follow stay exactly as they were.
--
-- REPORT records a reason from a fixed list (and optional details) against a
-- post or a person. The reporter is always auth.uid(), the time is the
-- server's, a repeat report is ignored, and nobody — reporter included —
-- can read reports back through the app: the table has no read policy.
-- Reporting a post you may not see answers exactly like a post that does not
-- exist, so a report cannot be used to learn that a hidden post is there.
--
-- Depends on 20261003100000 … 20261006100000.

-- ---------- 1. tables ----------
create table public.social_user_blocks (
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index social_user_blocks_blocked_idx on public.social_user_blocks (blocked_id);
alter table public.social_user_blocks enable row level security;
-- Your own blocks, and only yours: the blocked person cannot read that they are.
create policy user_blocks_select on public.social_user_blocks for select to authenticated
  using (blocker_id = auth.uid());
-- Written only through social_block_user / social_unblock_user, which also
-- remove the follows — a bare insert could not do that atomically.
revoke all on table public.social_user_blocks from anon, authenticated;
grant select on table public.social_user_blocks to authenticated;

create table public.social_user_mutes (
  muter_id uuid not null references public.users (id) on delete cascade,
  muted_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);
alter table public.social_user_mutes enable row level security;
create policy user_mutes_select on public.social_user_mutes for select to authenticated
  using (muter_id = auth.uid());
create policy user_mutes_insert on public.social_user_mutes for insert to authenticated
  with check (muter_id = auth.uid());
create policy user_mutes_delete on public.social_user_mutes for delete to authenticated
  using (muter_id = auth.uid());
revoke all on table public.social_user_mutes from anon, authenticated;
grant select, delete on table public.social_user_mutes to authenticated;
grant insert (muter_id, muted_id) on table public.social_user_mutes to authenticated;

create table public.social_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users (id) on delete cascade,
  reported_user_id uuid references public.users (id) on delete cascade,
  reported_post_id uuid references public.social_posts (id) on delete cascade,
  reason text not null
    check (reason in ('spam', 'harassment', 'inappropriate', 'false_information', 'other')),
  details text
    check (details is null or (char_length(details) between 1 and 500 and details = btrim(details))),
  created_at timestamptz not null default now(),
  -- exactly one target
  check ((reported_user_id is null) <> (reported_post_id is null))
);
comment on table public.social_reports is
  'User reports of a post or a person. Written only by social_report(); unreadable from the app (no select policy). No moderation workflow yet.';
create unique index social_reports_one_per_post on public.social_reports (reporter_id, reported_post_id)
  where reported_post_id is not null;
create unique index social_reports_one_per_user on public.social_reports (reporter_id, reported_user_id)
  where reported_user_id is not null;
alter table public.social_reports enable row level security;
revoke all on table public.social_reports from anon, authenticated;

-- ---------- 2. helpers ----------
-- Internal: called only from inside other security-definer functions, so
-- no signed-in user may call them directly — they would be an oracle.
create or replace function public.social_blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.social_user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;
revoke execute on function public.social_blocked_between(uuid, uuid) from public, anon, authenticated;

create or replace function public.social_is_muted(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_user_mutes m where m.muter_id = auth.uid() and m.muted_id = p_user
  );
$$;
revoke execute on function public.social_is_muted(uuid) from public, anon, authenticated;

-- is_listed_user: "may appear on a social surface" now also means "for this
-- caller" — not behind a block either way. 20261003100000 plus one line.
create or replace function public.is_listed_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = p_user and u.suspended_at is null)
     and not exists (select 1 from public.account_deletion_requests d where d.user_id = p_user)
     and not public.social_blocked_between(auth.uid(), p_user);
$$;

-- Nobody follows across a block, in either direction (and nobody follows an
-- account that is suspended or being deleted).
drop policy if exists follows_insert on public.social_follows;
create policy follows_insert on public.social_follows for insert to authenticated
  with check (follower_id = auth.uid() and public.is_listed_user(following_id));

-- ---------- 3. the writes ----------
-- Block: the block and the end of both follows, in one statement's transaction.
create or replace function public.social_block_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'cannot block yourself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  insert into public.social_user_blocks (blocker_id, blocked_id)
  values (auth.uid(), p_user)
  on conflict (blocker_id, blocked_id) do nothing;
  delete from public.social_follows
  where (follower_id = auth.uid() and following_id = p_user)
     or (follower_id = p_user and following_id = auth.uid());
end;
$$;

-- Unblock: the block goes; the follows it ended do not come back.
create or replace function public.social_unblock_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.social_user_blocks where blocker_id = auth.uid() and blocked_id = p_user;
end;
$$;

-- Report a post ('post') or a person ('user'). Idempotent per target.
create or replace function public.social_report(p_kind text, p_target uuid, p_reason text, p_details text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_author uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('spam', 'harassment', 'inappropriate', 'false_information', 'other') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'details too long' using errcode = '22023';
  end if;

  if p_kind = 'post' then
    -- Missing, deleted, private, behind a block: one answer for all of them.
    if p_target is null or not public.can_see_post(p_target) then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    select p.user_id into v_author from public.social_posts p where p.id = p_target;
    if v_author = auth.uid() then
      raise exception 'cannot report your own post' using errcode = '22023';
    end if;
    insert into public.social_reports (reporter_id, reported_post_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_post_id) where reported_post_id is not null do nothing;
  elsif p_kind = 'user' then
    if p_target = auth.uid() then
      raise exception 'cannot report yourself' using errcode = '22023';
    end if;
    -- A person may be reported after being blocked, so existence is the only test.
    if p_target is null or not exists (select 1 from public.users u where u.id = p_target) then
      raise exception 'user not found' using errcode = 'P0002';
    end if;
    insert into public.social_reports (reporter_id, reported_user_id, reason, details)
    values (auth.uid(), p_target, p_reason, v_details)
    on conflict (reporter_id, reported_user_id) where reported_user_id is not null do nothing;
  else
    raise exception 'unknown report target' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function
  public.social_block_user(uuid), public.social_unblock_user(uuid), public.social_report(text, uuid, text, text)
from public, anon;
grant execute on function
  public.social_block_user(uuid), public.social_unblock_user(uuid), public.social_report(text, uuid, text, text)
to authenticated;

-- ---------- 4. the visibility rules, with block ----------
-- can_see_post: the rule behind the feed, one post, comments, kudos and saves
-- (RLS and RPCs alike). 20260921100000's body plus one line.
create or replace function public.can_see_post(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post
      and p.deleted_at is null
      and not public.social_blocked_between(auth.uid(), p.user_id)
      and (
        p.user_id = auth.uid()
        or p.visibility = 'public'
        or (
          p.visibility = 'followers'
          and (public.is_following(p.user_id) or public.is_active_coach_of(p.user_id))
        )
      )
  );
$$;

-- user_can_see_post: the same for a named user — shares and mention notifications.
-- 20260930120000's body plus one line.
create or replace function public.user_can_see_post(p_user uuid, p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_post
      and p.deleted_at is null
      and not public.social_blocked_between(p_user, p.user_id)
      and (
        p.user_id = p_user
        or p.visibility = 'public'
        or (p.visibility = 'followers'
            and (exists (select 1 from public.social_follows f
                         where f.follower_id = p_user and f.following_id = p.user_id)
                 or exists (select 1 from public.trainer_clients tc
                            where tc.coach_id = p_user and tc.client_id = p.user_id
                              and tc.status = 'active')))
      )
  );
$$;
revoke execute on function public.user_can_see_post(uuid, uuid) from public, anon, authenticated;

-- ---------- 5. the feed, one post, the saved list ----------
-- 20261006100000 / 20261005100000 bodies plus: the mute filter (feed only),
-- `author_muted` for the post menu, and kudos names without hidden people.
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
  edited_at timestamptz, saved boolean, shared jsonb, comment_preview jsonb, author_muted boolean
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
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
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
revoke execute on function public.social_feed(int, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.social_feed(int, timestamptz, uuid, text, text) to authenticated;

drop function if exists public.social_saved_posts(int, timestamptz);
create function public.social_saved_posts(p_limit int default 20, p_before timestamptz default null)
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
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
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
revoke execute on function public.social_saved_posts(int, timestamptz) from public, anon;
grant execute on function public.social_saved_posts(int, timestamptz) to authenticated;

drop function if exists public.social_post(uuid);
create function public.social_post(p_post uuid)
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
    (select count(*)::int from public.social_comments c where c.post_id = p.id),
    exists (select 1 from public.social_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
    coalesce((select array_agg(x.name order by x.created_at, x.id) from (
      select coalesce(ru.username, ru.full_name) as name, r.created_at, r.id
      from public.social_reactions r join public.users ru on ru.id = r.user_id
      where r.post_id = p.id and public.is_listed_user(r.user_id) order by r.created_at, r.id limit 2
    ) x), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_post_mentions m join public.users mu on mu.id = m.user_id
      where m.post_id = p.id
    ), '[]'::jsonb),
    p.edited_at,
    exists (select 1 from public.social_post_saves sv where sv.post_id = p.id and sv.user_id = auth.uid()),
    case when p.type = 'shared_post' then public.social_shared_original(p.payload) end,
    public.social_is_muted(p.user_id)
  from public.social_posts p
  join public.users u on u.id = p.user_id
  where p.id = p_post and auth.uid() is not null and p.deleted_at is null and public.can_see_post(p.id)
    and (p.user_id = auth.uid() or public.is_listed_user(p.user_id));
$$;
revoke execute on function public.social_post(uuid) from public, anon;
grant execute on function public.social_post(uuid) to authenticated;
-- ---------- 6. the profile ----------
drop function if exists public.social_profile(uuid);
create function public.social_profile(p_user uuid)
returns table (
  id uuid, name text, username text, avatar_url text, city text, bio text,
  followers int, following int, posts int,
  stats_visible boolean,
  workouts int, prs int, challenges int, streak_days int, longest_streak int, badges int,
  fitness_score int, fitness_score_at timestamptz,
  is_following boolean, follows_me boolean,
  stats_visibility text, fitness_score_visibility text,
  blocked boolean, muted boolean
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
    case when public.can_see_fitness_score(u.id) and not bk.blocked then u.fitness_score_public::int end,
    case when public.can_see_fitness_score(u.id) and not bk.blocked then u.fitness_score_public_at end,
    public.is_following(u.id),
    exists (select 1 from public.social_follows f where f.follower_id = u.id and f.following_id = auth.uid()),
    case when u.id = auth.uid() then u.stats_visibility end,
    case when u.id = auth.uid() then u.fitness_score_visibility end,
    bk.blocked,
    public.social_is_muted(u.id)
  from public.users u
  -- Blocked by me: the page still opens (to unblock from), with nothing behind it.
  cross join lateral (select exists (select 1 from public.social_user_blocks b
                                    where b.blocker_id = auth.uid() and b.blocked_id = u.id) as blocked) bk
  cross join lateral (select public.can_see_stats(u.id) and not bk.blocked as ok) v
  left join lateral public.social_streak(u.id) st on true
  where u.id = p_user
    and auth.uid() is not null
    and (u.id = auth.uid() or public.is_listed_user(u.id)
         or (bk.blocked and u.suspended_at is null
             and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)));
$$;
revoke execute on function public.social_profile(uuid) from public, anon;
grant execute on function public.social_profile(uuid) to authenticated;

-- ---------- 7. people, stories, comments, kudos, mentions ----------
create or replace function public.social_follow_list(
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
    and public.is_listed_user(u.id)
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

create or replace function public.social_search_users(
  p_query text,
  p_city text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (id uuid, name text, username text, avatar_url text, city text, is_following boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, u.city,
         public.is_following(u.id)
  from public.users u
  where auth.uid() is not null
    and u.id <> auth.uid()
    -- someone who asked to be deleted is already anonymised; they are not findable
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)
    and u.suspended_at is null
    and public.is_listed_user(u.id)
    and (
      char_length(btrim(coalesce(p_query, ''))) >= 2
      or char_length(btrim(coalesce(p_city, ''))) >= 2
    )
    and (char_length(btrim(coalesce(p_query, ''))) < 2
         or u.username ilike '%' || btrim(p_query) || '%'
         or u.full_name ilike '%' || btrim(p_query) || '%')
    and (p_city is null or u.city ilike '%' || btrim(p_city) || '%')
  order by (u.username ilike btrim(coalesce(p_query, '')) || '%') desc, u.username nulls last, u.id
  limit greatest(1, least(coalesce(p_limit, 20), 50))
  offset greatest(0, least(coalesce(p_offset, 0), 1000));
$$;

create or replace function public.social_suggested_people(p_limit int default 10)
returns table (id uuid, name text, username text, avatar_url text, is_following boolean, mutuals int, followers int)
language sql stable security definer set search_path = public as $$
  with fof as (
    select f2.following_id as id, count(*)::int as mutuals
    from public.social_follows f1
    join public.social_follows f2 on f2.follower_id = f1.following_id
    where f1.follower_id = auth.uid()
      and f2.following_id <> auth.uid()
    group by f2.following_id
  ),
  popular as (
    select f.following_id as id, count(*)::int as followers
    from public.social_follows f
    where f.following_id <> auth.uid()
    group by f.following_id
    order by count(*) desc
    limit 50
  ),
  candidates as (
    select coalesce(a.id, b.id) as id, coalesce(a.mutuals, 0) as mutuals, coalesce(b.followers, 0) as followers
    from fof a full join popular b on a.id = b.id
  )
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url, false, c.mutuals,
         (select count(*)::int from public.social_follows f where f.following_id = u.id)
  from candidates c
  join public.users u on u.id = c.id
  where auth.uid() is not null
    and u.username is not null
    and u.suspended_at is null
    and public.is_listed_user(u.id)
    and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id)
    and not exists (select 1 from public.social_follows mine
                    where mine.follower_id = auth.uid() and mine.following_id = u.id)
  order by c.mutuals desc, c.followers desc, u.username
  limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;

create or replace function public.social_story_tray()
returns table (
  user_id uuid, name text, avatar_url text, is_me boolean,
  stories int, unseen int, latest_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with live as (
    select s.id, s.user_id, s.created_at,
           (s.user_id <> auth.uid()
            and not exists (select 1 from public.social_story_views v
                            where v.story_id = s.id and v.viewer_id = auth.uid())) as unseen
    from public.social_stories s
    where auth.uid() is not null
      and s.expires_at > now()
      and public.can_see_story_author(s.user_id)
      and not public.social_is_muted(s.user_id)
  )
  select u.id, coalesce(u.username, u.full_name), u.avatar_url, u.id = auth.uid(),
         count(*)::int, count(*) filter (where l.unseen)::int, max(l.created_at)
  from live l
  join public.users u on u.id = l.user_id
  group by u.id
  order by (u.id = auth.uid()) desc, (count(*) filter (where l.unseen) > 0) desc, max(l.created_at) desc, u.id
  limit 100;
$$;

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
      order by c.created_at, c.id
      limit 3
    ) rep
  )
  select
    t.id, t.parent_id, t.user_id,
    coalesce(u.username, u.full_name), u.username, u.avatar_url,
    t.body, t.created_at, t.edited_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_comment_mentions m
      join public.users mu on mu.id = m.user_id
      where m.comment_id = t.id
    ), '[]'::jsonb),
    (select count(*)::int from public.social_comments rc where rc.parent_id = t.id)
  from threads t
  join public.users u on u.id = t.user_id
  order by coalesce(t.parent_id, t.id), (t.parent_id is not null), t.created_at;
$$;

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
    coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', mu.username))
      from public.social_comment_mentions m join public.users mu on mu.id = m.user_id
      where m.comment_id = c.id
    ), '[]'::jsonb),
    0
  from public.social_comments c
  join public.social_comments parent on parent.id = c.parent_id
  join public.users u on u.id = c.user_id
  where c.parent_id = p_parent
    and not public.social_blocked_between(auth.uid(), c.user_id)
    and public.can_see_post(parent.post_id)
    and (p_after is null or c.created_at > p_after)
  order by c.created_at, c.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create or replace function public.social_post_kudos(p_post uuid, p_limit int default 20, p_before timestamptz default null)
returns table (user_id uuid, name text, username text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, coalesce(u.username, u.full_name), u.username, u.avatar_url, r.created_at
  from public.social_reactions r
  join public.users u on u.id = r.user_id
  where r.post_id = p_post
    and r.type = 'kudos'
    and public.can_see_post(p_post)
    and not public.social_blocked_between(auth.uid(), r.user_id)
    and (p_before is null or r.created_at < p_before)
  order by r.created_at desc, r.id desc
  limit greatest(1, least(p_limit, 50));
$$;

create or replace function public.social_mention_candidates(p_query text, p_post uuid default null)
returns table (id uuid, name text, username text, avatar_url text, can_see boolean)
language sql stable security definer set search_path = public as $$
  select u.id, coalesce(u.username, u.full_name), u.username, u.avatar_url,
    (p_post is null or exists (
      select 1 from public.social_posts p
      where p.id = p_post and p.deleted_at is null
        and (p.user_id = u.id or p.visibility = 'public'
             or (p.visibility = 'followers'
                 and (exists (select 1 from public.social_follows f
                              where f.follower_id = u.id and f.following_id = p.user_id)
                      or exists (select 1 from public.trainer_clients tc
                                 where tc.coach_id = u.id and tc.client_id = p.user_id
                                   and tc.status = 'active'))))
    )) as can_see
  from public.users u
  where u.id <> auth.uid()
    and u.username is not null
    and not public.social_blocked_between(auth.uid(), u.id)
    and char_length(btrim(coalesce(p_query, ''))) >= 1
    and u.username ilike btrim(p_query) || '%'
  order by can_see desc, u.username
  limit 8;
$$;
