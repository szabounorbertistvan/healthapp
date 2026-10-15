-- pgTAP · measurable goals (20261125110000_goal_metrics.sql):
--
--   1. the setup step's words-only main goal keeps working unchanged
--   2. a measurable goal must be well formed: shape, range, direction vs start,
--      dates, closure consistency
--   3. one active goal per data source; closed goals stay as history and free it
--   4. a lift goal cannot point at someone else's private custom exercise
--   5. at most 12 active measurable goals
--   6. separation: a stranger sees and changes nothing; the coach reads while
--      coaching and never writes; the read ends with the coaching
--
-- Run with a local stack up:  npm run db:test   (or offline: npm run db:test:offline goal_metrics)

begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- rows a write touched, as the current role sees them (RLS-filtered writes touch 0)
create or replace function pg_temp.touched(p_sql text) returns int language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c8000000-0000-0000-0000-000000000001', 'gm-coach@test.local',    '{"full_name":"Coach","username":"gmcoach"}'),
  ('c8000000-0000-0000-0000-000000000011', 'gm-client@test.local',   '{"full_name":"Client","username":"gmclient"}'),
  ('c8000000-0000-0000-0000-000000000013', 'gm-stranger@test.local', '{"full_name":"Stranger","username":"gmstranger"}');
update public.users set role = 'coach' where id = 'c8000000-0000-0000-0000-000000000001';
insert into public.trainer_clients (id, coach_id, client_id, status, started_at) values
  ('c8000000-0000-0000-0000-0000000000a1', 'c8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000011', 'active', now());

insert into public.exercises (id, name_en) values ('c8000000-0000-0000-0000-0000000000e1', 'GM Bench');
-- the stranger's private custom exercise (20261113100000: invisible to anyone else)
insert into public.exercises (id, name_en, source, owner_id) values
  ('c8000000-0000-0000-0000-0000000000e9', 'GM Secret lift', 'custom', 'c8000000-0000-0000-0000-000000000013');

-- ============================================================
-- 1. the setup step's main goal is untouched
-- ============================================================
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000011');
select lives_ok($$
  insert into public.goals (id, user_id, type, title)
  values ('c8000000-0000-0000-0000-0000000001f0', 'c8000000-0000-0000-0000-000000000011', 'weight', 'Fat loss')
$$, '1a. the setup step''s words-only goal still inserts as before (metric null)');
select is((select start_date from public.goals where id = 'c8000000-0000-0000-0000-0000000001f0'), current_date,
  '1b. a new row gets today as its start date');

-- ============================================================
-- 2. shape and range
-- ============================================================
select lives_ok($$
  insert into public.goals (id, user_id, type, title, metric, direction, target_value, start_value, start_date, target_date, exercise_id)
  values ('c8000000-0000-0000-0000-0000000001f1', 'c8000000-0000-0000-0000-000000000011', 'strength', 'Bench 100',
          'lift_weight', 'increase', 100, 80, current_date, current_date + 90, 'c8000000-0000-0000-0000-0000000000e1')
$$, '2a. a well-formed lift goal');
select lives_ok($$
  insert into public.goals (id, user_id, type, title, metric, direction, target_value, start_value, start_date)
  values ('c8000000-0000-0000-0000-0000000001f2', 'c8000000-0000-0000-0000-000000000011', 'weight', 'Weigh 75',
          'body_weight', 'decrease', 75, 82, current_date)
$$, '2b. a weight-loss goal counting down, no deadline');
select lives_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'habit', 'Train 3x', 'weekly_workouts', 'increase', 3, 0, current_date)
$$, '2c. zero is an honest start for workouts a week');
select lives_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'other', 'Protein', 'protein_avg', 'increase', 140, null, current_date)
$$, '2d. an unknown start is allowed (never invented)');

select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_value, start_date, exercise_id)
  values ('c8000000-0000-0000-0000-000000000011', 'strength', 'x', 'lift_weight', 'increase', 70, 80, current_date, 'c8000000-0000-0000-0000-0000000000e1')
$$, '23514', '2e. a target behind the start in the goal''s direction is refused');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'strength', 'x', 'lift_weight', 'increase', 100, current_date)
$$, '23514', '2f. a lift goal without an exercise is refused');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, exercise_id)
  values ('c8000000-0000-0000-0000-000000000011', 'strength', 'x', 'lift_weight', 'decrease', 50, current_date, 'c8000000-0000-0000-0000-0000000000e1')
$$, '23514', '2g. a lift can only count up');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, measure_key)
  values ('c8000000-0000-0000-0000-000000000011', 'weight', 'x', 'body_weight', 'decrease', 70, current_date, 'waist')
$$, '23514', '2h. only a circumference goal carries a measurement key');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, measure_key)
  values ('c8000000-0000-0000-0000-000000000011', 'other', 'x', 'circumference', 'decrease', 80, current_date, 'ear')
$$, '23514', '2i. an unknown measurement key is refused');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'weight', 'x', 'body_weight', 'decrease', 5, current_date)
$$, '23514', '2j. a body weight target outside 20..400 kg is refused');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'habit', 'x', 'consistency', 'increase', 140, current_date)
$$, '23514', '2k. a percentage over 100 is refused');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, target_date)
  values ('c8000000-0000-0000-0000-000000000011', 'other', 'x', 'kcal_on_target', 'increase', 80, current_date, current_date - 1)
$$, '23514', '2l. a deadline before the start is refused');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'other', 'x', 'happiness', 'increase', 80, current_date)
$$, '23514', '2m. an unknown metric is refused');
select throws_ok($$
  update public.goals set status = 'achieved' where id = 'c8000000-0000-0000-0000-0000000001f2'
$$, '23514', '2n. achieved without achieved_at / closed_at is refused');

-- ============================================================
-- 3. one active goal per source
-- ============================================================
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'weight', 'Gain', 'body_weight', 'increase', 90, current_date)
$$, '23505', '3a. a second active body-weight goal is refused, whatever its direction');
select lives_ok($$
  update public.goals set status = 'abandoned', closed_at = now() where id = 'c8000000-0000-0000-0000-0000000001f2'
$$, '3b. the owner abandons the first');
select lives_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'weight', 'Weigh 78', 'body_weight', 'decrease', 78, current_date)
$$, '3c. which frees the source for a new active goal');
select is((select count(*)::int from public.goals where user_id = 'c8000000-0000-0000-0000-000000000011' and metric = 'body_weight'), 2,
  '3d. the abandoned goal stays as history');
select lives_ok($$
  update public.goals set status = 'achieved', achieved_at = now(), closed_at = now() where id = 'c8000000-0000-0000-0000-0000000001f1'
$$, '3e. marking achieved with its timestamps is accepted');

-- ============================================================
-- 4. no pointing at someone else's private exercise
-- ============================================================
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, exercise_id)
  values ('c8000000-0000-0000-0000-000000000011', 'strength', 'x', 'lift_weight', 'increase', 60, current_date, 'c8000000-0000-0000-0000-0000000000e9')
$$, '23503', '4a. a lift goal on someone else''s private custom exercise is refused');

-- ============================================================
-- 5. at most 12 active measurable goals
-- ============================================================
-- three active so far (workouts, protein, weight); add circumference goals up to twelve
insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, measure_key)
select 'c8000000-0000-0000-0000-000000000011', 'other', 'c ' || k, 'circumference', 'decrease', 50, current_date, k
from unnest(array['waist', 'hips', 'chest', 'arm', 'thigh', 'neck']) as k;
insert into public.goals (user_id, type, title, metric, direction, target_value, start_date) values
  ('c8000000-0000-0000-0000-000000000011', 'habit', 'cons', 'consistency', 'increase', 90, current_date),
  ('c8000000-0000-0000-0000-000000000011', 'habit', 'kcal', 'kcal_on_target', 'increase', 80, current_date);
insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, exercise_id) values
  ('c8000000-0000-0000-0000-000000000011', 'strength', 'bench again', 'lift_weight', 'increase', 110, current_date, 'c8000000-0000-0000-0000-0000000000e1');
select is((select count(*)::int from public.goals where user_id = 'c8000000-0000-0000-0000-000000000011' and status = 'active' and metric is not null), 12,
  '5a. twelve active measurable goals');
reset role;
insert into public.exercises (id, name_en) values ('c8000000-0000-0000-0000-0000000000e2', 'GM Row');
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000011');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date, exercise_id)
  values ('c8000000-0000-0000-0000-000000000011', 'strength', 'row', 'lift_weight', 'increase', 80, current_date, 'c8000000-0000-0000-0000-0000000000e2')
$$, '23514', '5b. a thirteenth is refused');
select lives_ok($$
  insert into public.goals (user_id, type, title) values ('c8000000-0000-0000-0000-000000000011', 'other', 'Feel better')
$$, '5c. the cap does not count the words-only main goal');

-- ============================================================
-- 6. separation
-- ============================================================
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000013');
select is((select count(*)::int from public.goals where user_id = 'c8000000-0000-0000-0000-000000000011'), 0,
  '6a. a stranger reads none of the client''s goals');
select is(pg_temp.touched($$ update public.goals set target_value = 200 where user_id = 'c8000000-0000-0000-0000-000000000011' $$), 0,
  '6b. nor changes any');
select is(pg_temp.touched($$ delete from public.goals where user_id = 'c8000000-0000-0000-0000-000000000011' $$), 0,
  '6c. nor deletes any');
select throws_ok($$
  insert into public.goals (user_id, type, title, metric, direction, target_value, start_date)
  values ('c8000000-0000-0000-0000-000000000011', 'habit', 'planted', 'consistency', 'increase', 50, current_date)
$$, '42501', '6d. nor plants one on the client''s account');

select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');
select ok((select count(*) from public.goals where user_id = 'c8000000-0000-0000-0000-000000000011') > 0,
  '6e. the active coach reads the client''s goals');
select is(pg_temp.touched($$ update public.goals set target_value = 200 where user_id = 'c8000000-0000-0000-0000-000000000011' $$), 0,
  '6f. but cannot change them');
select is(public.coaching_transition('c8000000-0000-0000-0000-0000000000a1', 'ended'), 'ended', '6g. the coach ends the coaching');
select is((select count(*)::int from public.goals where user_id = 'c8000000-0000-0000-0000-000000000011'), 0,
  '6h. and reads nothing any more');
reset role;

select * from finish();
rollback;
