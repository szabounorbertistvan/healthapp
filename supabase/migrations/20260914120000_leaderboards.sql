-- HealthApp schema · leaderboards
--
-- Who trained the most, on five aggregate metrics (training load, volume,
-- workouts, active days, streak) over this week, this month or all time. The
-- reference rules are packages/shared/src/leaderboard.ts; this file mirrors
-- them so the whole ranking happens in one query and the browser receives
-- the top rows plus the caller's own — never a session, a set or a body
-- weight.
--
-- 1. training_load_score() is trainingLoadFromStats() in SQL, so a session's
--    score is summed here without shipping every session to the app. The
--    parity table in packages/shared/src/leaderboard.test.ts and
--    supabase/tests/leaderboard.test.sql pins the two together.
-- 2. users.leaderboard_visibility — public / followers / private. No UI
--    writes it yet; the default keeps today's behaviour (the social profile
--    already shows workout counts to anyone signed in). The RPC honours it.
-- 3. social_leaderboard(metric, period, scope) — security definer for the
--    same reason as social_feed(): users_select hides names. It validates
--    every argument against a fixed list, aggregates in the caller's and
--    each person's own timezone, ranks deterministically, and returns the
--    top N plus the caller's row. `scope` is 'global' only for now; club and
--    gym are the planned values, which is why it is an argument.

-- ---------- 1. training load, mirrored ----------
-- trainingLoadFromStats(): weighted saturating curves, absent signals drop
-- out and the weights renormalise. double precision throughout so exp() and
-- the rounding agree with JavaScript.
create or replace function public.training_load_score(
  p_volume_kg double precision,
  p_sets int,
  p_duration_min int,
  p_intensity double precision,
  p_exercises int
) returns int language sql immutable as $$
  with s as (
    select
      greatest(0, coalesce(p_volume_kg, 0)) as volume,
      greatest(0, coalesce(p_sets, 0))::double precision as sets,
      case when p_duration_min between 1 and 360 then p_duration_min end::double precision as duration,
      p_intensity as intensity,
      greatest(0, coalesce(p_exercises, 0))::double precision as exercises
  ),
  w as (
    select
      0.40 * 100 * (1 - exp(-volume / 8000.0)) as v_volume, 0.40 as a_volume,
      0.25 * 100 * (1 - exp(-sets / 18.0)) as v_sets, 0.25 as a_sets,
      case when duration is null then 0 else 0.15 * 100 * (1 - exp(-duration / 60.0)) end as v_duration,
      case when duration is null then 0 else 0.15 end as a_duration,
      case when intensity is null then 0 else 0.15 * least(100, greatest(0, (intensity - 4) / 6.0 * 100)) end as v_intensity,
      case when intensity is null then 0 else 0.15 end as a_intensity,
      case when exercises > 0 then 0.05 * 100 * (1 - exp(-exercises / 5.0)) else 0 end as v_exercises,
      case when exercises > 0 then 0.05 else 0 end as a_exercises,
      sets
    from s
  )
  select case
    when sets = 0 then 0
    else least(100, greatest(0, round(
      (v_volume + v_sets + v_duration + v_intensity + v_exercises)
      / (a_volume + a_sets + a_duration + a_intensity + a_exercises)
    )))::int
  end
  from w;
$$;
grant execute on function public.training_load_score(double precision, int, int, double precision, int) to authenticated;

-- ---------- 2. the setting ----------
alter table public.users
  add column if not exists leaderboard_visibility text not null default 'public'
  check (leaderboard_visibility in ('public', 'followers', 'private'));
comment on column public.users.leaderboard_visibility is
  'Who may see this person on leaderboards: public (anyone signed in), followers, private (only themselves). No UI yet.';

-- ---------- 3. the leaderboard ----------
create or replace function public.social_leaderboard(
  p_metric text,
  p_period text,
  p_scope text default 'global',
  p_limit int default 10
)
returns table (
  rank int,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  score numeric,
  secondary_score numeric,
  is_current_user boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- Fixed vocabularies: nothing from the caller reaches the SQL as text.
  if p_metric not in ('training_load', 'volume', 'workouts', 'active_days', 'streak') then
    raise exception 'unknown leaderboard metric' using errcode = '22023';
  end if;
  if p_period not in ('week', 'month', 'all') then
    raise exception 'unknown leaderboard period' using errcode = '22023';
  end if;
  if p_scope <> 'global' then
    raise exception 'unknown leaderboard scope' using errcode = '22023';
  end if;
  if auth.uid() is null then
    return;
  end if;

  return query
  with people as (
    -- Everyone the caller may see on a board: the setting, or themselves.
    select u.id, coalesce(u.username, u.full_name) as display_name, u.username, u.avatar_url,
           u.created_at, coalesce(u.timezone, 'Europe/Bucharest') as tz,
           (now() at time zone coalesce(u.timezone, 'Europe/Bucharest'))::date as today
    from public.users u
    where u.id = auth.uid()
       or u.leaderboard_visibility = 'public'
       or (u.leaderboard_visibility = 'followers' and public.is_following(u.id))
  ),
  windows as (
    -- Each person's window on their own calendar: Monday → today, the 1st → today, or open.
    select p.*,
           case p_period
             when 'week' then date_trunc('week', p.today::timestamp)::date
             when 'month' then date_trunc('month', p.today::timestamp)::date
             else null
           end as period_start
    from people p
  ),
  sessions as (
    -- One row per completed session with the same rollup challenge_progress_rows()
    -- uses, scored by the mirrored formula. Every session, not only the window:
    -- a streak needs the days before it.
    select
      w.id as uid,
      (s.started_at at time zone w.tz)::date as day,
      w.period_start, w.today,
      public.training_load_score(
        coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision,
        count(ls.id) filter (where ls.reps > 0)::int,
        nullif(round(extract(epoch from (s.completed_at - s.started_at)) / 60)::int, 0),
        avg(least(10, greatest(1, coalesce(ls.rpe, 10 - ls.rir)))) filter (where ls.reps > 0)::double precision,
        count(distinct ls.exercise_id) filter (where ls.reps > 0)::int
      ) as load,
      coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0) as volume_kg
    from public.logged_sessions s
    join windows w on w.id = s.user_id
    left join public.logged_sets ls on ls.session_id = s.id
    where s.completed_at is not null
    group by w.id, s.id, s.started_at, s.completed_at, w.tz, w.period_start, w.today
  ),
  inside as (
    select * from sessions
    where (period_start is null or day >= period_start) and day <= today
  ),
  -- streak: gaps and islands over every active day, keep the runs touching the window
  days as (
    select distinct uid, day, period_start, today from sessions
  ),
  runs as (
    select uid, day, period_start, today,
           day - (row_number() over (partition by uid order by day))::int as grp
    from days
  ),
  streaks as (
    select uid, min(day) as s, max(day) as e, count(*)::int as len, period_start, today
    from runs group by uid, grp, period_start, today
  ),
  streak_score as (
    select uid, max(len) as best
    from streaks
    where (period_start is null or e >= period_start) and s <= today
    group by uid
  ),
  totals as (
    select
      i.uid,
      sum(i.load)::numeric as load,
      round(sum(i.volume_kg))::numeric as volume,
      count(*)::numeric as workouts,
      count(distinct i.day)::numeric as active_days
    from inside i
    group by i.uid
  ),
  scored as (
    select
      p.id, p.display_name, p.username, p.avatar_url, p.created_at,
      case p_metric
        when 'training_load' then coalesce(t.load, 0)
        when 'volume' then coalesce(t.volume, 0)
        when 'workouts' then coalesce(t.workouts, 0)
        when 'active_days' then coalesce(t.active_days, 0)
        else coalesce(ss.best, 0)::numeric
      end as score,
      case p_metric
        when 'training_load' then coalesce(t.volume, 0)
        when 'volume' then coalesce(t.workouts, 0)
        when 'workouts' then coalesce(t.volume, 0)
        when 'active_days' then coalesce(t.workouts, 0)
        else coalesce(t.active_days, 0)
      end as secondary
    from people p
    left join totals t on t.uid = p.id
    left join streak_score ss on ss.uid = p.id
  ),
  ranked as (
    -- Only people with something on the board; a quiet week is not a last place.
    select
      row_number() over (order by sc.score desc, sc.secondary desc, sc.created_at asc, sc.id asc)::int as rank,
      sc.*
    from scored sc
    where sc.score > 0
  )
  select r.rank, r.id, r.display_name, r.username, r.avatar_url, r.score, r.secondary, r.id = auth.uid()
  from ranked r
  where r.rank <= greatest(1, least(p_limit, 50)) or r.id = auth.uid()
  order by r.rank;
end;
$$;
grant execute on function public.social_leaderboard(text, text, text, int) to authenticated;
