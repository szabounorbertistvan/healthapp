-- Measurable personal goals: the Goal dashboard on Progress (2026-11-25)
--
-- public.goals (20260823000200) has always existed — user-owned, coach-readable
-- (goals_owner / goals_coach_read) — but it holds one row per person today: the
-- *main* goal the setup steps write as words ("Fat loss"), with no number on it
-- (onboarding-actions saveSetupGoal). The Goal dashboard needs goals with a
-- number: "bench 100 kg", "weigh 75 kg by January", "train 4× a week". This
-- extends the same table instead of adding a second goals system:
--
--   metric        what is measured; NULL = the setup step's main goal, which
--                 keeps working exactly as it did (every check below is
--                 conditioned on metric is not null, and the setup step's reads
--                 now filter metric is null so a measurable goal never replaces it)
--   direction     increase | decrease — "lose weight" counts down
--   start_value   the value at the start, when known (never invented; the app
--                 prefills it from the person's latest real value)
--   start_date    the day progress is counted from (no default backfill: the
--                 existing rows keep NULL, a new one gets current_date)
--   exercise_id   the lift a lift goal follows
--   measure_key   the circumference a circumference goal follows
--   achieved_at   when the person marked it achieved
--   closed_at     when it left 'active' (achieved or abandoned)
--
-- Values are canonical: kg, cm, workouts a week, percent, grams — display
-- converts to the person's units. The unit is a property of the metric, so no
-- unit column. Progress itself is NOT stored: packages/shared/goals computes it
-- from measurements, logged sets and food logs on every read, so it moves when
-- new data lands and history is never rewritten.
--
-- Nothing existing changes: no row is updated, no policy is loosened. The
-- owner policy (user_id = auth.uid()) and the coach's read stay as they are.

alter table public.goals
  add column if not exists metric text,
  add column if not exists direction text,
  add column if not exists start_value numeric,
  add column if not exists start_date date,
  add column if not exists exercise_id uuid references public.exercises (id) on delete cascade,
  add column if not exists measure_key text,
  add column if not exists achieved_at timestamptz,
  add column if not exists closed_at timestamptz;

-- set separately so the existing rows are not backfilled with today's date
alter table public.goals alter column start_date set default current_date;

-- ---------- what a measurable goal must look like ----------
-- Mirrors validateGoalInput() / GOAL_METRIC_SPEC in packages/shared/src/goals.ts.
alter table public.goals drop constraint if exists goals_metric_known;
alter table public.goals add constraint goals_metric_known check (
  metric is null or metric in
    ('body_weight', 'circumference', 'lift_weight', 'weekly_workouts', 'consistency', 'kcal_on_target', 'protein_avg')
);

alter table public.goals drop constraint if exists goals_metric_shape;
alter table public.goals add constraint goals_metric_shape check (
  metric is null or (
    direction in ('increase', 'decrease')
    and target_value is not null
    and start_date is not null
    and (exercise_id is not null) = (metric = 'lift_weight')
    and (measure_key is not null) = (metric = 'circumference')
    and (measure_key is null or measure_key in ('waist', 'hips', 'chest', 'arm', 'thigh', 'neck'))
    -- some metrics only count one way
    and (metric not in ('lift_weight', 'weekly_workouts', 'consistency', 'kcal_on_target') or direction = 'increase')
  )
);

alter table public.goals drop constraint if exists goals_metric_range;
alter table public.goals add constraint goals_metric_range check (
  metric is null or (
    case metric
      when 'body_weight'     then target_value between 20 and 400
      when 'circumference'   then target_value between 10 and 300
      when 'lift_weight'     then target_value between 0.5 and 1000
      when 'weekly_workouts' then target_value between 0.5 and 14
      when 'consistency'     then target_value between 1 and 100
      when 'kcal_on_target'  then target_value between 1 and 100
      when 'protein_avg'     then target_value between 10 and 500
    end
    and (start_value is null or (start_value >= 0 and start_value <= case metric
      when 'body_weight' then 400 when 'circumference' then 300 when 'lift_weight' then 1000
      when 'weekly_workouts' then 14 when 'protein_avg' then 500 else 100 end))
  )
);

-- the target lies in the goal's direction from a known start
alter table public.goals drop constraint if exists goals_target_vs_start;
alter table public.goals add constraint goals_target_vs_start check (
  metric is null or start_value is null
  or (direction = 'increase' and target_value > start_value)
  or (direction = 'decrease' and target_value < start_value)
);

alter table public.goals drop constraint if exists goals_dates_order;
alter table public.goals add constraint goals_dates_order check (
  target_date is null or start_date is null or target_date >= start_date
);

-- achieved_at belongs to achieved goals, closed_at to closed ones
alter table public.goals drop constraint if exists goals_closure_consistent;
alter table public.goals add constraint goals_closure_consistent check (
  metric is null or (
    (achieved_at is not null) = (status = 'achieved')
    and (closed_at is not null) = (status <> 'active')
  )
);

-- ---------- one active goal per source ----------
-- Two active goals on the same data (two body-weight goals, two goals on the
-- same lift) would contradict or duplicate each other. Closed goals stay as history.
create unique index if not exists goals_one_active_per_source
  on public.goals (user_id, metric, coalesce(exercise_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(measure_key, ''))
  where status = 'active' and metric is not null;

create index if not exists goals_user_status_idx on public.goals (user_id, status);

-- ---------- writes the policy cannot see ----------
-- Security invoker on purpose: the exercise lookup runs under the caller's
-- RLS, so a lift goal cannot point at someone else's private custom exercise
-- (the FK alone would accept any existing id, and its error would confirm it
-- exists). The cap keeps one person from filling the table.
create or replace function public.goals_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.metric is null then
    return new;
  end if;
  if new.exercise_id is not null
     and (tg_op = 'INSERT' or new.exercise_id is distinct from old.exercise_id)
     and not exists (select 1 from public.exercises where id = new.exercise_id) then
    raise exception 'GOAL_EXERCISE' using errcode = '23503';
  end if;
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and (select count(*) from public.goals
          where user_id = new.user_id and status = 'active' and metric is not null and id <> new.id) >= 12 then
    raise exception 'GOAL_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.goals_guard() from public, anon, authenticated;

drop trigger if exists goals_guard on public.goals;
create trigger goals_guard before insert or update on public.goals
  for each row execute function public.goals_guard();

comment on column public.goals.metric is
  'What a measurable goal measures (packages/shared GOAL_METRICS). NULL = the setup step''s main goal, words only.';
comment on column public.goals.start_value is
  'Value at the start, canonical unit; NULL when unknown — never invented (the first real value since start_date is then the baseline).';
