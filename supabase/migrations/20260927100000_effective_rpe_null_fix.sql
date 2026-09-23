-- HealthApp schema · a set with no RPE and no RIR has no intensity
--
-- Every SQL rollup that fed training_load_score() averaged
--
--     least(10, greatest(1, coalesce(ls.rpe, 10 - ls.rir)))
--
-- over a session's sets. When a set carries neither an RPE nor an RIR the
-- coalesce is NULL — and greatest(1, NULL) is 1 in Postgres, because GREATEST
-- and LEAST ignore NULL arguments. So a set logged without intensity counted as
-- "RPE 1" and dragged the session's mean intensity (and its training load)
-- down. packages/shared does the opposite: effectiveRpe() returns null for such
-- a set and trainingLoad() averages only the sets that have a value.
--
-- The fix is one function, not three filters. effective_rpe() is effectiveRpe()
-- in SQL: the RPE if present, else 10 − RIR, clamped 1..10, else NULL. avg()
-- skips NULLs by definition, which is exactly the TypeScript
-- `rpes.filter((r) => r !== null)` followed by the mean. A session whose sets
-- all lack intensity now reaches training_load_score() with a NULL intensity,
-- and that function already drops the signal and renormalises the weights —
-- as trainingLoadFromStats() does.
--
-- Why not fix it inside training_load_score(): that function receives the
-- intensity already averaged. The NULL became 1 one step earlier, in each
-- per-set rollup, so the per-set conversion is the piece that had to be shared.
--
-- The three function bodies below are copied unchanged from their current
-- migrations; the only edit in each is the intensity expression:
--   challenge_progress_rows  ← 20260912100000_challenges.sql
--   social_leaderboard       ← 20260916120000_leaderboard_following.sql
--   fitness_score_of         ← 20260926100000_social_v2_cleanup.sql
--     (already correct via a hand-written filter; now uses the same function,
--      which gives the same numbers — social_v2_cleanup.test.sql still pins them)
-- Criteria, periods, ranking, visibility and RLS are untouched. Sets WITH an
-- RPE or an RIR produce exactly the value they produced before.

-- ---------- the shared per-set conversion ----------
/**
 * effectiveRpe() from packages/shared/src/training-load.ts:
 *   rpe present  → clamp(rpe, 1, 10)
 *   else rir     → clamp(10 − rir, 1, 10)
 *   else         → NULL (no intensity signal — never 1)
 */
create or replace function public.effective_rpe(p_rpe numeric, p_rir numeric)
returns numeric language sql immutable parallel safe as $$
  select case
    when p_rpe is not null then least(10, greatest(1, p_rpe))
    when p_rir is not null then least(10, greatest(1, 10 - p_rir))
    else null
  end;
$$;
grant execute on function public.effective_rpe(numeric, numeric) to authenticated;

-- ---------- challenges ----------
create or replace function public.challenge_progress_rows(p_challenge uuid)
returns table (
  user_id uuid,
  full_name text,
  username text,
  kind text,
  day date,
  sets int,
  volume_kg numeric,
  duration_min int,
  mean_rpe numeric,
  exercises int
) language sql stable security definer set search_path = public as $$
  with c as (
    select id, start_date, end_date from public.challenges where id = p_challenge
  ),
  members as (
    select p.user_id, u.full_name, u.username, u.timezone
    from public.challenge_participants p
    join public.users u on u.id = p.user_id
    where p.challenge_id = p_challenge
      and public.can_see_challenge(p_challenge)
  ),
  sessions as (
    select
      s.user_id,
      s.id as session_id,
      (s.started_at at time zone m.timezone)::date as day,
      s.started_at,
      s.completed_at
    from public.logged_sessions s
    join members m on m.user_id = s.user_id
    cross join c
    where s.completed_at is not null
      and (s.started_at at time zone m.timezone)::date between c.start_date and c.end_date
  )
  select
    m.user_id, m.full_name, m.username,
    'session' as kind,
    ss.day,
    count(ls.id) filter (where ls.reps > 0)::int as sets,
    coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0), 0) as volume_kg,
    nullif(round(extract(epoch from (ss.completed_at - ss.started_at)) / 60)::int, 0) as duration_min,
    avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0) as mean_rpe,
    count(distinct ls.exercise_id) filter (where ls.reps > 0)::int as exercises
  from sessions ss
  join members m on m.user_id = ss.user_id
  left join public.logged_sets ls on ls.session_id = ss.session_id
  group by m.user_id, m.full_name, m.username, ss.session_id, ss.day, ss.started_at, ss.completed_at

  union all

  select m.user_id, m.full_name, m.username, 'day', d.day, null, null, null, null, null
  from members m
  cross join c
  join lateral (
    select f.date as day from public.food_logs f
    where f.user_id = m.user_id and f.date between c.start_date and c.end_date
    union
    select h.date from public.habit_logs h
    where h.user_id = m.user_id and h.date between c.start_date and c.end_date
  ) d on true;
$$;
grant execute on function public.challenge_progress_rows(uuid) to authenticated;

-- ---------- leaderboards ----------
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
  if p_scope not in ('global', 'following') then
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
    where (
      u.id = auth.uid()
      or u.leaderboard_visibility = 'public'
      or (u.leaderboard_visibility = 'followers' and public.is_following(u.id))
    )
    -- 'following' narrows the same visible set to the people the caller
    -- follows, plus themselves. It never widens it: someone who is private
    -- stays off the board even if you follow them.
    and (
      p_scope = 'global'
      or u.id = auth.uid()
      or public.is_following(u.id)
    )
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
        avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0)::double precision,
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

-- ---------- fitness score (same result, shared conversion) ----------
create or replace function public.fitness_score_of(p_user uuid)
returns table (
  score int, status text, band text,
  completed_workouts int, active_days int, total_volume double precision, average_training_load double precision
) language sql stable security definer set search_path = public as $$
  with tz as (
    select coalesce(u.timezone, 'Europe/Bucharest') as name from public.users u where u.id = p_user
  ),
  win as (
    -- fitnessScoreWindow(today, 0): the 28 inclusive local days ending today.
    select (now() at time zone (select name from tz))::date as today
  ),
  sessions as (
    -- loadOf(): sets with reps > 0 carry volume, count and intensity; the
    -- exercise count is every distinct exercise on the session (loadOf counts
    -- names across all sets); duration is Math.round(ms / 60 000).
    select
      (s.started_at at time zone (select name from tz))::date as day,
      public.training_load_score(
        coalesce(sum(greatest(coalesce(ls.weight_kg, 0), 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision,
        (count(ls.id) filter (where ls.reps > 0))::int,
        floor(extract(epoch from (s.completed_at - s.started_at))::double precision / 60 + 0.5)::int,
        (avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0))::double precision,
        (count(distinct ls.exercise_id))::int
      ) as load,
      -- TrainingLoad.volume_kg is Math.round(volume); fitness-score-data sums that.
      floor(coalesce(sum(greatest(coalesce(ls.weight_kg, 0), 0) * ls.reps) filter (where ls.reps > 0), 0)::double precision + 0.5) as volume_kg
    from public.logged_sessions s
    left join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user
      and s.completed_at is not null
      and (s.started_at at time zone (select name from tz))::date
          between (select today from win) - 27 and (select today from win)
    group by s.id, s.started_at, s.completed_at
  ),
  totals as (
    select
      count(*)::int as workouts,
      count(distinct day)::int as days,
      coalesce(sum(volume_kg), 0)::double precision as volume,
      -- sum / n in double precision, as the reduce in fitnessScore() does it
      case when count(*) = 0 then 0::double precision else sum(load)::double precision / count(*) end as avg_load
    from sessions
  ),
  subs as (
    select t.*,
      least(100, greatest(0, case when t.avg_load <= 0 then 0 else 100 * (1 - exp(-t.avg_load / 40.0)) end)) as tl,
      least(100, greatest(0, t.days::double precision / 16 * 100)) as cons,
      least(100, greatest(0, t.workouts::double precision / 16 * 100)) as freq,
      least(100, greatest(0, t.volume / 50000 * 100)) as vol
    from totals t
  ),
  scored as (
    select s.*,
      case when s.workouts < 3 then null
           else least(100, greatest(0, floor(s.tl * 0.35 + s.cons * 0.25 + s.freq * 0.2 + s.vol * 0.2 + 0.5)))::int
      end as sc
    from subs s
  )
  select
    sc,
    case when sc is null then 'building' else 'active' end,
    case when sc is null then null
         when sc >= 80 then 'strong_activity'
         when sc >= 60 then 'developing'
         when sc >= 40 then 'building'
         else 'getting_started' end,
    workouts, days, volume, avg_load
  from scored;
$$;
-- Engine-only: answering it for an arbitrary id would expose someone's
-- training volume. The two callers below ask it about the caller / the author.
revoke execute on function public.fitness_score_of(uuid) from public, anon, authenticated;
