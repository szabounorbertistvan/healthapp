-- HealthApp schema · one volume rule: a warm-up set adds no volume, in SQL too
--
-- The app has counted volume one way since 16970c1 (2026-10-15): a set whose
-- prescription is a warm-up (program_exercises.set_type = 'warmup',
-- 20260930100000) still counts as a set, but adds nothing to Σ weight × reps —
-- totalVolume() and trainingLoad() in packages/shared, read through
-- prescribed:program_exercises(set_type) (apps/web/lib/logged-sets.ts,
-- apps/web/lib/training-load.ts). The SQL rollups kept adding warm-ups in, so the
-- same week had two volumes: the fitness score on Today said one thing and
-- fitness_score_of() (what a shared score post carries) another; the training
-- load card one thing and the training_load / volume leaderboards another; the
-- weekly volume in Progress one thing and a volume challenge or the volume_kg
-- achievement another.
--
-- is_warmup_set() is that rule once, and every volume sum in the functions
-- below now filters by it. Nothing else in them changes: each body is its
-- latest definition copied verbatim (file named above each one) with only the
-- volume filter added. Set counts, mean intensity, exercise counts and PR
-- detection are untouched — a warm-up is still a set, as in the app. A set
-- logged outside a program (program_exercise_id null) or against a deleted
-- prescription is a working set, as in the app (prescribed is null there).
--
-- Left alone on purpose, with no app number to agree with: gym_stats /
-- gym_tops (gym-level aggregates) and the admin_* panel totals.
--
-- No row is written: the numbers are computed on read, so past weeks recount
-- the moment this is applied. Challenge standings and volume achievements of
-- people who logged warm-ups move down by exactly their warm-up volume.

/** True when the set's prescription is a warm-up. Null / unknown id = a working set. */
create or replace function public.is_warmup_set(p_program_exercise_id uuid)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (select pe.set_type = 'warmup' from public.program_exercises pe where pe.id = p_program_exercise_id),
    false)
$$;
comment on function public.is_warmup_set(uuid) is
  'The app''s volume rule (packages/shared totalVolume / trainingLoad): a set prescribed as a warm-up adds no volume.';
revoke execute on function public.is_warmup_set(uuid) from public, anon;
grant execute on function public.is_warmup_set(uuid) to authenticated;

-- ============================================================================
-- fitness_score_of — body from 20260930140000_effective_rpe_null_fix.sql; only the volume filter differs
-- ============================================================================

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
        coalesce(sum(greatest(coalesce(ls.weight_kg, 0), 0) * ls.reps) filter (where ls.reps > 0 and not public.is_warmup_set(ls.program_exercise_id)), 0)::double precision,
        (count(ls.id) filter (where ls.reps > 0))::int,
        floor(extract(epoch from (s.completed_at - s.started_at))::double precision / 60 + 0.5)::int,
        (avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0))::double precision,
        (count(distinct ls.exercise_id))::int
      ) as load,
      -- TrainingLoad.volume_kg is Math.round(volume); fitness-score-data sums that.
      floor(coalesce(sum(greatest(coalesce(ls.weight_kg, 0), 0) * ls.reps) filter (where ls.reps > 0 and not public.is_warmup_set(ls.program_exercise_id)), 0)::double precision + 0.5) as volume_kg
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

-- ============================================================================
-- social_leaderboard — body from 20261023100000_gyms.sql; only the volume filter differs
-- ============================================================================

create or replace function public.social_leaderboard(
  p_metric text,
  p_period text,
  p_scope text default 'global',
  p_limit int default 10
)
returns table (
  rank int, user_id uuid, display_name text, username text, avatar_url text,
  score numeric, secondary_score numeric, is_current_user boolean
) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_gym uuid;
begin
  -- Fixed vocabularies: nothing from the caller reaches the SQL as text.
  if p_metric not in ('training_load', 'volume', 'workouts', 'active_days', 'streak') then
    raise exception 'unknown leaderboard metric' using errcode = '22023';
  end if;
  if p_period not in ('week', 'month', 'all') then
    raise exception 'unknown leaderboard period' using errcode = '22023';
  end if;
  if p_scope not in ('global', 'following', 'gym') then
    raise exception 'unknown leaderboard scope' using errcode = '22023';
  end if;
  if auth.uid() is null then
    return;
  end if;
  if p_scope = 'gym' then
    -- Reciprocal: only someone on the board sees it, so nobody watches who
    -- trains at a gym without being shown there themselves.
    select u.home_gym_id into v_gym from public.users u where u.id = auth.uid() and u.gym_board;
    if v_gym is null then
      return;
    end if;
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
    -- Not eligible at all while suspended or being deleted: not ranked, not
    -- shown. (A block is different — see `visible` below.)
    and (
      u.id = auth.uid()
      or (u.suspended_at is null
          and not exists (select 1 from public.account_deletion_requests d where d.user_id = u.id))
    )
    -- 'following' narrows the same visible set to the people the caller
    -- follows, plus themselves. It never widens it: someone who is private
    -- stays off the board even if you follow them.
    and (
      p_scope <> 'following'
      or u.id = auth.uid()
      or public.is_following(u.id)
    )
    -- 'gym' (20261023100000) narrows it the same way, to the caller's own
    -- gym and to people there who opted in to its board.
    and (
      p_scope <> 'gym'
      or u.id = auth.uid()
      or (u.home_gym_id = v_gym and u.gym_board)
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
        coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0 and not public.is_warmup_set(ls.program_exercise_id)), 0)::double precision,
        count(ls.id) filter (where ls.reps > 0)::int,
        nullif(round(extract(epoch from (s.completed_at - s.started_at)) / 60)::int, 0),
        avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0)::double precision,
        count(distinct ls.exercise_id) filter (where ls.reps > 0)::int
      ) as load,
      coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0 and not public.is_warmup_set(ls.program_exercise_id)), 0) as volume_kg
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
  ),
  -- Block (20261007100000) is applied here and only here: after the ranking,
  -- to what this caller receives. Everyone is ranked as before, so every
  -- visible person keeps their own rank number, score and place in the
  -- order; the blocked person's row simply is not handed over, and the top
  -- p_limit is filled from the next visible rows.
  visible as (
    select r.*, row_number() over (order by r.rank) as shown
    from ranked r
    where r.id = auth.uid() or not public.social_blocked_between(auth.uid(), r.id)
  )
  select v.rank, v.id, v.display_name, v.username, v.avatar_url, v.score, v.secondary, v.id = auth.uid()
  from visible v
  where v.shown <= greatest(1, least(p_limit, 50)) or v.id = auth.uid()
  order by v.rank;
end;
$$;

-- ============================================================================
-- challenge_progress_rows — body from 20260930140000_effective_rpe_null_fix.sql; only the volume filter differs
-- ============================================================================

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
    coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0 and not public.is_warmup_set(ls.program_exercise_id)), 0) as volume_kg,
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

-- ============================================================================
-- challenge_value — body from 20261001100000_advanced_challenges.sql; only the volume filter differs
-- ============================================================================

create or replace function public.challenge_value(p_challenge uuid, p_user uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges;
  tz text;
  v numeric;
  base_key numeric;
  cur_key numeric;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then return null; end if;
  select coalesce(u.timezone, 'Europe/Bucharest') into tz from public.users u where u.id = p_user;
  tz := coalesce(tz, 'Europe/Bucharest');

  if c.type = 'workouts' then
    select count(*) into v from public.logged_sessions s
    where s.user_id = p_user and s.completed_at is not null
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'volume' then
    select coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where not public.is_warmup_set(ls.program_exercise_id)), 0) into v
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null and ls.reps > 0
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'training_load' then
    -- The same per-session rollup challenge_progress_rows produced, scored by
    -- training_load_score() (trainingLoadFromStats in SQL).
    select coalesce(sum(public.training_load_score(
             r.volume_kg::double precision, r.sets, r.duration_min, r.mean_rpe::double precision, r.exercises)), 0)
      into v
    from (
      select
        count(ls.id) filter (where ls.reps > 0)::int as sets,
        coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0 and not public.is_warmup_set(ls.program_exercise_id)), 0) as volume_kg,
        nullif(round(extract(epoch from (s.completed_at - s.started_at)) / 60)::int, 0) as duration_min,
        avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0) as mean_rpe,
        count(distinct ls.exercise_id) filter (where ls.reps > 0)::int as exercises
      from public.logged_sessions s
      left join public.logged_sets ls on ls.session_id = s.id
      where s.user_id = p_user and s.completed_at is not null
        and (s.started_at at time zone tz)::date between c.start_date and c.end_date
      group by s.id, s.started_at, s.completed_at
    ) r;

  elsif c.type = 'active_days' then
    select count(*) into v from (
      select (s.started_at at time zone tz)::date as d from public.logged_sessions s
      where s.user_id = p_user and s.completed_at is not null
        and (s.started_at at time zone tz)::date between c.start_date and c.end_date
      union
      select f.date from public.food_logs f
      where f.user_id = p_user and f.date between c.start_date and c.end_date
      union
      select h.date from public.habit_logs h
      where h.user_id = p_user and h.date between c.start_date and c.end_date
    ) days;

  elsif c.type = 'exercise_sessions' then
    select count(distinct s.id) into v
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null
      and ls.exercise_id = c.exercise_id and ls.reps > 0
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'strength_gain' then
    -- e1RM × 30, exact: a single at face value, otherwise weight × (30 + reps).
    select max(case when ls.reps = 1 then ls.weight_kg * 30 else ls.weight_kg * (30 + ls.reps) end)
      into base_key
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null
      and ls.exercise_id = c.exercise_id and ls.weight_kg > 0 and ls.reps between 1 and 12
      and (s.started_at at time zone tz)::date < c.start_date;
    select max(case when ls.reps = 1 then ls.weight_kg * 30 else ls.weight_kg * (30 + ls.reps) end)
      into cur_key
    from public.logged_sessions s join public.logged_sets ls on ls.session_id = s.id
    where s.user_id = p_user and s.completed_at is not null
      and ls.exercise_id = c.exercise_id and ls.weight_kg > 0 and ls.reps between 1 and 12
      and (s.started_at at time zone tz)::date between c.start_date and c.end_date;
    -- No lift before the start (or none yet inside) means no gain to report.
    v := case when base_key is null or cur_key is null or base_key <= 0 then 0
              else greatest(0, (cur_key - base_key) * 100 / base_key) end;

  elsif c.type = 'check_ins' then
    select count(*) into v from public.check_ins ci
    where ci.user_id = p_user
      and (ci.submitted_at at time zone tz)::date between c.start_date and c.end_date;

  elsif c.type = 'nutrition_days' then
    select count(*) into v from (
      select f.date from public.food_logs f
      where f.user_id = p_user and f.date between c.start_date and c.end_date
      group by f.date having sum(f.kcal) > 0
    ) days;

  elsif c.type = 'habit_completions' then
    select count(*) into v from public.habit_logs h
    where h.user_id = p_user and h.date between c.start_date and c.end_date;
  end if;

  return coalesce(v, 0);
end;
$$;

-- ============================================================================
-- achievement_facts — body from 20261002110000_advanced_achievements.sql; only the volume filter differs
-- ============================================================================

create or replace function public.achievement_facts(p_user uuid, p_metrics text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb := '{}'::jsonb;
  tz text;
  want text[] := coalesce(p_metrics, array[
    'workouts', 'longest_streak', 'prs', 'checkins', 'challenges', 'longest_food_run',
    'volume_kg', 'active_days', 'nutrition_days', 'bench_kg', 'squat_kg', 'deadlift_kg', 'e1rm_total_kg']);
  n numeric;
  lifts jsonb;
begin
  if p_user is null then return f; end if;
  select coalesce(u.timezone, 'Europe/Bucharest') into tz from public.users u where u.id = p_user;
  tz := coalesce(tz, 'Europe/Bucharest');

  if 'workouts' = any(want) then
    select count(*) into n from public.logged_sessions where user_id = p_user and completed_at is not null;
    f := f || jsonb_build_object('workouts', n);
  end if;

  if 'longest_streak' = any(want) then
    f := f || jsonb_build_object('longest_streak', public.longest_workout_streak(p_user));
  end if;

  if 'prs' = any(want) then
    select count(*) into n from public.logged_sets where user_id = p_user and is_pr;
    f := f || jsonb_build_object('prs', n);
  end if;

  if 'checkins' = any(want) then
    select count(*) into n from public.check_ins where user_id = p_user;
    f := f || jsonb_build_object('checkins', n);
  end if;

  if 'challenges' = any(want) then
    select count(*) into n from public.challenge_participants where user_id = p_user and completed_at is not null;
    f := f || jsonb_build_object('challenges', n);
  end if;

  if 'longest_food_run' = any(want) then
    select coalesce(max(c), 0) into n from (
      select count(*) as c from (
        select d - (row_number() over (order by d))::int as grp
        from (select distinct date as d from public.food_logs where user_id = p_user) days
      ) runs group by grp
    ) x;
    f := f || jsonb_build_object('longest_food_run', n);
  end if;

  if 'volume_kg' = any(want) then
    select coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where not public.is_warmup_set(ls.program_exercise_id)), 0) into n
    from public.logged_sets ls
    join public.logged_sessions s on s.id = ls.session_id
    where ls.user_id = p_user and s.completed_at is not null and ls.reps > 0;
    f := f || jsonb_build_object('volume_kg', n);
  end if;

  if 'active_days' = any(want) then
    select count(*) into n from (
      select (s.started_at at time zone tz)::date as d from public.logged_sessions s
      where s.user_id = p_user and s.completed_at is not null
      union
      select fl.date from public.food_logs fl where fl.user_id = p_user
      union
      select h.date from public.habit_logs h where h.user_id = p_user
    ) days;
    f := f || jsonb_build_object('active_days', n);
  end if;

  if 'nutrition_days' = any(want) then
    select count(*) into n from (
      select fl.date from public.food_logs fl where fl.user_id = p_user
      group by fl.date having sum(fl.kcal) > 0
    ) days;
    f := f || jsonb_build_object('nutrition_days', n);
  end if;

  if want && array['bench_kg', 'squat_kg', 'deadlift_kg', 'e1rm_total_kg'] then
    with canon(lift, external_id) as (
      values ('bench', 'Barbell_Bench_Press_-_Medium_Grip'), ('bench', 'Bench_Press_-_Powerlifting'),
             ('squat', 'Barbell_Squat'), ('squat', 'Barbell_Full_Squat'),
             ('deadlift', 'Barbell_Deadlift')
    ),
    ids as (
      select c.lift, e.id from canon c
      join public.exercises e
        on e.external_id = c.external_id and e.source = 'free-exercise-db' and e.owner_id is null
    ),
    per as (
      select i.lift,
             max(ls.weight_kg) as top_kg,
             -- relevantOneRm × 30, exact: a single at face value, else w · (30 + reps).
             max(case when ls.reps = 1 then ls.weight_kg * 30
                      when ls.reps <= 12 then ls.weight_kg * (30 + ls.reps) end) as key30
      from public.logged_sets ls
      join ids i on i.id = ls.exercise_id
      join public.logged_sessions s on s.id = ls.session_id
      where ls.user_id = p_user and s.completed_at is not null
        and ls.weight_kg > 0 and ls.reps >= 1
      group by i.lift
    )
    select jsonb_build_object(
      'bench_kg',      coalesce(max(top_kg) filter (where lift = 'bench'), 0),
      'squat_kg',      coalesce(max(top_kg) filter (where lift = 'squat'), 0),
      'deadlift_kg',   coalesce(max(top_kg) filter (where lift = 'deadlift'), 0),
      'e1rm_total_kg', round(coalesce(sum(key30), 0) / 30, 2))
    into lifts from per;
    f := f || lifts;
  end if;

  return f;
end;
$$;

-- ============================================================================
-- social_posts_guard — body from 20261014100000_social_reactions_reconcile.sql; only the volume filter differs
-- ============================================================================

create or replace function public.social_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_badge record;
  v_real record;
  v_milestone int;
  v_original uuid;
  v_orig public.social_posts;
  v_session public.logged_sessions;
  v_set public.logged_sets;
  v_challenge public.challenges;
  v_name text;
  v_sets int;
  v_volume numeric;
  v_rpe numeric;
  v_exercises int;
  v_prs int;
  v_duration int;
  v_photo text;
  v_photo_re text;
  v_started timestamptz;
  v_start date;
  v_tz text;
begin
  -- photo: the one thing a post takes from the server action as given. Kept
  -- only as a Cloudinary upload in this author's own post folder.
  v_photo_re := '^https://res\.cloudinary\.com/[^/?#]+/image/upload/([^?#]*/)?voinic/posts/'
                || new.user_id::text || '/[^/?#]+$';

  if new.type = 'text' then
    -- photo: a text post has no payload unless it carries a picture, and then
    -- the picture and nothing else.
    v_photo := new.payload ->> 'photo_url';
    if new.payload ->> 'kind' = 'text' and v_photo is not null and v_photo ~ v_photo_re then
      new.payload := jsonb_build_object(
        'kind', 'text',
        'photo_url', v_photo,
        'photo_w', new.payload -> 'photo_w',
        'photo_h', new.payload -> 'photo_h',
        'overlay', new.payload -> 'overlay');
    else
      new.payload := null;
    end if;
    return new;
  end if;
  if new.payload is not null and new.payload ->> 'kind' is distinct from new.type then
    raise exception 'payload kind does not match post type' using errcode = '22023';
  end if;

  if new.type = 'achievement' then
    select b.slug, b.name_en, b.name_ro, b.icon, b.category, b.rarity, b.metric, b.target, ub.awarded_at
      into v_badge
    from public.user_badges ub join public.badges b on b.id = ub.badge_id
    where ub.user_id = new.user_id and b.slug = new.payload ->> 'badge_slug';
    if not found then
      raise exception 'badge not earned' using errcode = '42501';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'achievement', 'badge_slug', v_badge.slug, 'name_en', v_badge.name_en,
      'name_ro', v_badge.name_ro, 'icon', v_badge.icon, 'awarded_at', v_badge.awarded_at,
      'category', v_badge.category, 'rarity', v_badge.rarity,
      'metric', v_badge.metric, 'target', v_badge.target);
  elsif new.type = 'fitness_score' then
    select f.score, f.band into v_real from public.fitness_score_of(new.user_id) f;
    if v_real.score is null then
      raise exception 'fitness score is still building' using errcode = '22023';
    end if;
    select max(m) into v_milestone
    from unnest(array[25, 50, 60, 70, 80, 90, 100]) m
    where m <= v_real.score;
    if v_milestone is null then
      raise exception 'fitness score is below the first milestone' using errcode = '22023';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'fitness_score', 'score', v_real.score, 'milestone', v_milestone, 'band', v_real.band);
  elsif new.type = 'shared_post' then
    begin
      v_original := (new.payload ->> 'original_post_id')::uuid;
    exception when invalid_text_representation then
      v_original := null;
    end;
    select * into v_orig from public.social_posts where id = v_original;
    -- A share of a share is a share of the original.
    if found and v_orig.type = 'shared_post' then
      v_original := (v_orig.payload ->> 'original_post_id')::uuid;
      select * into v_orig from public.social_posts where id = v_original;
    end if;
    -- One answer for missing, deleted, private and unfollowed alike, so the
    -- error cannot be used to learn that a hidden post exists.
    if v_orig.id is null
       or not public.user_can_see_post(new.user_id, v_orig.id)
       or not public.is_listed_user(v_orig.user_id) then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    if v_orig.user_id = new.user_id then
      raise exception 'cannot share your own post' using errcode = '22023';
    end if;
    new.payload := jsonb_build_object('kind', 'shared_post', 'original_post_id', v_orig.id);
  elsif new.type = 'workout' then
    -- Your own completed session, rebuilt with the rollup the leaderboards use.
    select * into v_session from public.logged_sessions s
    where s.id = new.activity_id and s.user_id = new.user_id and s.completed_at is not null;
    if v_session.id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    select coalesce((select d.name from public.program_days d where d.id = v_session.program_day_id), 'Workout')
      into v_name;
    select
      count(ls.id) filter (where ls.reps > 0)::int,
      coalesce(sum(greatest(ls.weight_kg, 0) * ls.reps) filter (where ls.reps > 0 and not public.is_warmup_set(ls.program_exercise_id)), 0),
      avg(public.effective_rpe(ls.rpe, ls.rir)) filter (where ls.reps > 0),
      count(distinct ls.exercise_id) filter (where ls.reps > 0)::int,
      count(*) filter (where ls.is_pr)::int
      into v_sets, v_volume, v_rpe, v_exercises, v_prs
    from public.logged_sets ls where ls.session_id = v_session.id;
    v_duration := nullif(round(extract(epoch from (v_session.completed_at - v_session.started_at)) / 60)::int, 0);
    v_photo := new.payload ->> 'photo_url';
    if v_photo is null or v_photo !~ v_photo_re then
      v_photo := null;
    end if;
    new.payload := jsonb_build_object(
      'kind', 'workout',
      'name', v_name,
      'date', to_char(v_session.started_at at time zone 'UTC', 'YYYY-MM-DD'),
      'duration_min', v_duration,
      'exercises', v_exercises,
      'sets', v_sets,
      'volume_kg', round(v_volume)::float8,
      'load', least(100, greatest(0, public.training_load_score(
                v_volume::double precision, v_sets, v_duration, v_rpe::double precision, v_exercises))),
      'prs', v_prs,
      'photo_url', v_photo,
      -- photo: its size and the overlay the author placed, only with a photo.
      'photo_w', case when v_photo is not null then new.payload -> 'photo_w' end,
      'photo_h', case when v_photo is not null then new.payload -> 'photo_h' end,
      'overlay', case when v_photo is not null then new.payload -> 'overlay' end);
  elsif new.type = 'pr' then
    -- A set of yours, in the named session, that the PR engine flagged.
    select ls.* into v_set from public.logged_sets ls
    join public.logged_sessions s on s.id = ls.session_id
    where ls.id = public.social_try_uuid(new.payload ->> 'set_id')
      and ls.user_id = new.user_id and ls.is_pr
      and s.id = new.activity_id and s.user_id = new.user_id and s.completed_at is not null;
    if v_set.id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    select s.started_at into v_started from public.logged_sessions s where s.id = v_set.session_id;
    new.payload := jsonb_build_object(
      'kind', 'pr',
      'exercise', coalesce((select coalesce(x.name_ro, x.name_en) from public.exercises x where x.id = v_set.exercise_id), '—'),
      -- float8: plain JSON numbers (100, 116.7), the shape the app always wrote
      'weight_kg', v_set.weight_kg::float8,
      'reps', v_set.reps,
      -- estimated1RMExact (Epley), only up to 12 reps, to one decimal; 0 outside that.
      'estimated_1rm', case
        when v_set.weight_kg > 0 and v_set.reps between 1 and 12 then
          (round((case when v_set.reps = 1 then v_set.weight_kg
                       else v_set.weight_kg * (1 + v_set.reps / 30.0) end) * 10) / 10)::float8
        else 0 end,
      'date', to_char(v_started at time zone 'UTC', 'YYYY-MM-DD'));
  elsif new.type = 'challenge_completed' then
    -- A challenge you completed; its titles and numbers from the challenge itself.
    select c.* into v_challenge from public.challenges c
    where c.id = new.challenge_id
      and exists (select 1 from public.challenge_participants p
                  where p.challenge_id = c.id and p.user_id = new.user_id and p.completed_at is not null);
    if v_challenge.id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'challenge_completed',
      'title_en', v_challenge.title_en,
      'title_ro', v_challenge.title_ro,
      'type', v_challenge.type,
      'target', v_challenge.target_value::float8,
      'value', public.challenge_value(v_challenge.id, new.user_id)::float8);
  elsif new.type = 'streak' then
    -- A run of your own workout days (local days, users.timezone — the
    -- workout_days rule) that started on streak_start and reached the
    -- milestone. Shareable milestones: STREAK_MILESTONES from STREAK_SHARE_MIN.
    begin
      v_milestone := (new.payload ->> 'milestone')::int;
      v_start := (new.payload ->> 'streak_start')::date;
    exception when others then
      v_milestone := null;
    end;
    select coalesce(u.timezone, 'Europe/Bucharest') into v_tz from public.users u where u.id = new.user_id;
    if v_milestone is null or v_start is null
       or v_milestone not in (7, 14, 30, 60, 90, 180, 365)
       or exists (select 1 from public.logged_sessions s
                  where s.user_id = new.user_id and s.completed_at is not null
                    and (s.started_at at time zone v_tz)::date = v_start - 1)
       or (select count(distinct (s.started_at at time zone v_tz)::date) from public.logged_sessions s
           where s.user_id = new.user_id and s.completed_at is not null
             and (s.started_at at time zone v_tz)::date between v_start and v_start + (v_milestone - 1)) < v_milestone then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
    new.payload := jsonb_build_object(
      'kind', 'streak',
      'streak_days', v_milestone,
      'milestone', v_milestone,
      'achieved_at', to_char(v_start + (v_milestone - 1), 'YYYY-MM-DD'),
      'streak_start', to_char(v_start, 'YYYY-MM-DD'),
      'title', v_milestone || ' Day Streak');
  end if;
  return new;
end;
$$;
