-- HealthApp schema · workout streaks
--
-- A streak is derived, never stored: consecutive local days with at least
-- one completed logged_session, on the user's own calendar (users.timezone).
-- The day a session counts on is the day its started_at falls in that zone —
-- the same rule challenge_progress_rows() uses, so "active workout day" means
-- one thing everywhere. Nothing a client sends can move a streak; only
-- finishing workouts can.
--
-- Two reads:
-- 1. workout_days(): one row per day with a count — the caller's own by
--    default, or a client's for their coach (security invoker: RLS on
--    logged_sessions decides, exactly as everywhere else) —
--    for the streak engine and the 12-week calendar (packages/shared/streaks).
--    Aggregated in SQL so a long history never ships one row per session.
-- 2. social_streak(): another person's current and longest streak as two
--    numbers, computed here — the profile shows the numbers, never the days.
--    Security definer because logged_sessions is private; the SQL mirrors
--    streakRuns()/currentStreak() in packages/shared exactly.
--
-- Plus the 'streak' post type for sharing a milestone: a snapshot payload,
-- deduped by (milestone, streak_start) so a milestone is shared once.

-- ---------- 1. own days ----------
create or replace function public.workout_days(p_user uuid default null)
returns table (day text, workouts int)
language sql stable security invoker set search_path = public as $$
  select
    to_char((s.started_at at time zone coalesce(u.timezone, 'Europe/Bucharest'))::date, 'YYYY-MM-DD') as day,
    count(*)::int as workouts
  from public.logged_sessions s
  left join public.users u on u.id = s.user_id
  where s.user_id = coalesce(p_user, auth.uid())
    and s.completed_at is not null
  group by 1
  order by 1;
$$;
grant execute on function public.workout_days(uuid) to authenticated;

-- ---------- 2. someone's streak, numbers only ----------
create or replace function public.social_streak(p_user uuid)
returns table (current_days int, longest_days int)
language sql stable security definer set search_path = public as $$
  with tz as (
    select coalesce(u.timezone, 'Europe/Bucharest') as name from public.users u where u.id = p_user
  ),
  days as (
    select distinct (s.started_at at time zone (select name from tz))::date as d
    from public.logged_sessions s
    where s.user_id = p_user and s.completed_at is not null
  ),
  -- gaps and islands: consecutive dates share (d - row_number)
  runs as (
    select d, d - (row_number() over (order by d))::int as grp from days
  ),
  streaks as (
    select min(d) as s, max(d) as e, count(*)::int as len from runs group by grp
  ),
  today as (
    select (now() at time zone (select name from tz))::date as d
  )
  select
    coalesce((select st.len from streaks st, today where st.e >= today.d - 1 order by st.e desc limit 1), 0),
    coalesce((select max(st.len) from streaks st), 0);
$$;
grant execute on function public.social_streak(uuid) to authenticated;

-- ---------- 3. the streak post ----------
-- the inline check from the social migration got the default name; drop it by
-- what it says rather than by name, in case the name differs.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.social_posts'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%challenge_completed%'
  loop
    execute format('alter table public.social_posts drop constraint %I', v_name);
  end loop;
end $$;
alter table public.social_posts add constraint social_posts_type_check
  check (type in ('workout', 'pr', 'challenge_completed', 'progress', 'text', 'streak'));

-- one post per milestone per streak
create unique index if not exists social_posts_one_per_streak_milestone
  on public.social_posts (user_id, (payload ->> 'milestone'), (payload ->> 'streak_start'))
  where type = 'streak' and deleted_at is null;
