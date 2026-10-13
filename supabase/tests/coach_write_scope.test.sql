-- pgTAP · coach and client writes stay inside the columns and the relationship
-- they exist for (20261122100000_coach_write_scope).
--
-- Every "cannot" below was a "can" before that migration; every "can" is a
-- legitimate path the migration must keep open. Sections are independent of
-- one another's writes except where a step says so (the coaching that ends in
-- 3 is the one 3b reads back).
--
-- Cast:
--   c1  coach of m1 (active, paused in 3c) and m2 (active, ended in 3b)
--   c2  a coach with no relationship to anyone here
--   m1, m2  c1's clients     s  a client nobody coaches     ad  an admin

begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- A write the caller should not be able to make: RLS may refuse it with an
-- error or filter it to zero rows depending on the policy shape, so it is
-- attempted here and the assertions after it judge what actually changed.
create or replace function pg_temp.attempt(p_sql text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
exception when others then
  null;
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c5000000-0000-0000-0000-000000000001', 'ws-coach@test.local',    '{}'),
  ('c5000000-0000-0000-0000-000000000002', 'ws-other@test.local',    '{}'),
  ('c5000000-0000-0000-0000-000000000011', 'ws-maria@test.local',    '{}'),
  ('c5000000-0000-0000-0000-000000000012', 'ws-andrei@test.local',   '{}'),
  ('c5000000-0000-0000-0000-000000000013', 'ws-stranger@test.local', '{}'),
  ('c5000000-0000-0000-0000-000000000099', 'ws-admin@test.local',    '{}');
update public.users set role = 'coach'
 where id in ('c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');
update public.users set role = 'admin' where id = 'c5000000-0000-0000-0000-000000000099';

insert into public.trainer_clients (id, coach_id, client_id, status, started_at) values
  ('c5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000011', 'active', now()),
  ('c5000000-0000-0000-0000-0000000000a2', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'active', now());

insert into public.exercises (id, name_en) values ('c5000000-0000-0000-0000-0000000000ee', 'WS Squat');
insert into public.foods (id, source, external_id, name_en, kcal_100g) values ('c5000000-0000-0000-0000-0000000000ff', 'usda', 'ws:oats', 'WS Oats', 380);

-- m1: a check-in with the coach's feedback, a filmed set
insert into public.check_ins (id, user_id, week_start, weight_kg, energy, note) values
  ('c5000000-0000-0000-0000-0000000000c1', 'c5000000-0000-0000-0000-000000000011', current_date, 70.0, 3, 'tired');
insert into public.coach_feedback (id, coach_id, client_id, reference_type, reference_id, body) values
  ('c5000000-0000-0000-0000-0000000000f1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000011',
   'check_in', 'c5000000-0000-0000-0000-0000000000c1', 'Solid week');
insert into public.logged_sessions (id, user_id, started_at, completed_at, client_generated_id) values
  ('c5000000-0000-0000-0000-0000000005a1', 'c5000000-0000-0000-0000-000000000011', now() - interval '1 hour', now(), gen_random_uuid()),
  ('c5000000-0000-0000-0000-0000000005a2', 'c5000000-0000-0000-0000-000000000012', now() - interval '1 hour', null, gen_random_uuid());
insert into public.logged_sets (id, session_id, user_id, exercise_id, set_index, weight_kg, reps, client_generated_id) values
  ('c5000000-0000-0000-0000-0000000005b0', 'c5000000-0000-0000-0000-0000000005a1', 'c5000000-0000-0000-0000-000000000011',
   'c5000000-0000-0000-0000-0000000000ee', 1, 80, 5, gen_random_uuid());
insert into public.set_videos (id, logged_set_id, user_id, storage_path) values
  ('c5000000-0000-0000-0000-0000000005c1', 'c5000000-0000-0000-0000-0000000005b0', 'c5000000-0000-0000-0000-000000000011', 'videos/m1/set1.mp4');

-- m2: two published programs (b1 with a day and an exercise, b3 to delete
-- while coaching), a draft program, a published plan with a meal and a food,
-- a draft plan
insert into public.programs (id, coach_id, client_id, name, status) values
  ('c5000000-0000-0000-0000-0000000000b1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Strength', 'published'),
  ('c5000000-0000-0000-0000-0000000000b2', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Unsent', 'draft'),
  ('c5000000-0000-0000-0000-0000000000b3', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Old block', 'published');
insert into public.program_days (id, program_id, day_index, name) values
  ('c5000000-0000-0000-0000-0000000000d1', 'c5000000-0000-0000-0000-0000000000b1', 1, 'Upper A');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps) values
  ('c5000000-0000-0000-0000-00000000007a', 'c5000000-0000-0000-0000-0000000000d1', 'c5000000-0000-0000-0000-0000000000ee', 0, 3, '8');
insert into public.nutrition_plans (id, coach_id, client_id, name, status, kcal_target) values
  ('c5000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Cut', 'published', 2000),
  ('c5000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Unsent', 'draft', 1800);
insert into public.planned_meals (id, plan_id, slot, name) values
  ('c5000000-0000-0000-0000-0000000000e9', 'c5000000-0000-0000-0000-0000000000e1', 'breakfast', 'Oats');

-- m1: a published program with a day, a published plan with a meal (for the pause)
insert into public.programs (id, coach_id, client_id, name, status) values
  ('c5000000-0000-0000-0000-0000000000b4', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000011', 'Base', 'published');
insert into public.program_days (id, program_id, day_index, name) values
  ('c5000000-0000-0000-0000-0000000000d4', 'c5000000-0000-0000-0000-0000000000b4', 1, 'Full body');
insert into public.nutrition_plans (id, coach_id, client_id, name, status, kcal_target) values
  ('c5000000-0000-0000-0000-0000000000e4', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000011', 'Maintain', 'published', 2300);
insert into public.planned_meals (id, plan_id, slot, name) values
  ('c5000000-0000-0000-0000-0000000000e8', 'c5000000-0000-0000-0000-0000000000e4', 'lunch', 'Rice bowl');

-- m1: a habit the coach set (created_by c1, owned by m1)
insert into public.habits (id, user_id, created_by, name) values
  ('c5000000-0000-0000-0000-00000000007b', 'c5000000-0000-0000-0000-000000000011', 'c5000000-0000-0000-0000-000000000001', 'Walk 8k');

-- ============================================================================
-- 1. coach_feedback: the client marks it read and changes nothing else
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select lives_ok($$ update public.coach_feedback set read_at = now() where id = 'c5000000-0000-0000-0000-0000000000f1' $$,
  '1. the client marks their feedback read');
select throws_ok($$ update public.coach_feedback set body = 'You are the best client ever' where id = 'c5000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, '1. the client cannot rewrite what the coach wrote');
select throws_ok($$ update public.coach_feedback set coach_id = 'c5000000-0000-0000-0000-000000000002' where id = 'c5000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, '1. nor hand the feedback to another coach');
reset role;
select is((select body from public.coach_feedback where id = 'c5000000-0000-0000-0000-0000000000f1'), 'Solid week',
  '1. the feedback is the coach''s words');
select isnt((select read_at from public.coach_feedback where id = 'c5000000-0000-0000-0000-0000000000f1'), null,
  '1. and it is marked read');
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.coach_feedback), 0, '1. the other coach sees no feedback under their name');
reset role;
select ok(not has_column_privilege('authenticated', 'public.coach_feedback', 'body', 'UPDATE')
          and has_column_privilege('authenticated', 'public.coach_feedback', 'read_at', 'UPDATE'),
  '1. the privilege layer itself: read_at only');

-- ============================================================================
-- 2. check_ins and set_videos: the coach stamps the review, the rest is the client's
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.check_ins set coach_reviewed_at = now() where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  '2. the coach marks the check-in reviewed');
select throws_ok($$ update public.check_ins set weight_kg = 95 where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  '42501', 'REVIEW_ONLY', '2. the coach cannot change the client''s weight');
select throws_ok($$ update public.check_ins set note = 'all good', coach_reviewed_at = now() where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  '42501', 'REVIEW_ONLY', '2. nor their note, even alongside the review stamp');
select lives_ok($$ update public.set_videos set review_status = 'reviewed' where id = 'c5000000-0000-0000-0000-0000000005c1' $$,
  '2. the coach marks the set video reviewed');
select throws_ok($$ update public.set_videos set storage_path = 'videos/elsewhere.mp4' where id = 'c5000000-0000-0000-0000-0000000005c1' $$,
  '42501', 'REVIEW_ONLY', '2. the coach cannot re-point the video');
select throws_ok($$ update public.set_videos set logged_set_id = 'c5000000-0000-0000-0000-0000000005b0', review_status = 'pending',
                    user_id = 'c5000000-0000-0000-0000-000000000011', storage_path = 'x' where id = 'c5000000-0000-0000-0000-0000000005c1' $$,
  '42501', 'REVIEW_ONLY', '2. nor change anything but its review status in one go');
reset role;
-- an unrelated coach reaches neither row (RLS: zero rows, nothing changes)
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000002');
select pg_temp.attempt($$update public.check_ins set coach_reviewed_at = null where id = 'c5000000-0000-0000-0000-0000000000c1'$$);
select pg_temp.attempt($$update public.set_videos set review_status = 'pending' where id = 'c5000000-0000-0000-0000-0000000005c1'$$);
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select lives_ok($$ update public.check_ins set note = 'tired, slept badly' where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  '2. the client still edits their own check-in');
select lives_ok($$ update public.set_videos set storage_path = 'videos/m1/set1-trimmed.mp4' where id = 'c5000000-0000-0000-0000-0000000005c1' $$,
  '2. and replaces their own video');
reset role;
select is((select weight_kg::numeric from public.check_ins where id = 'c5000000-0000-0000-0000-0000000000c1'), 70.0::numeric,
  '2. the weight is what the client entered');
select is((select note from public.check_ins where id = 'c5000000-0000-0000-0000-0000000000c1'), 'tired, slept badly',
  '2. the note is the client''s');
select isnt((select coach_reviewed_at from public.check_ins where id = 'c5000000-0000-0000-0000-0000000000c1'), null,
  '2. the review stamp stuck, and the unrelated coach could not clear it');
select is((select storage_path || ' ' || review_status from public.set_videos where id = 'c5000000-0000-0000-0000-0000000005c1'),
  'videos/m1/set1-trimmed.mp4 reviewed', '2. the video is the client''s file, reviewed by their coach only');

-- ============================================================================
-- 3. the coach's reach into a plan ends with the coaching
-- ============================================================================
-- 3a. while coaching: full control, including deleting a published program
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.program_days set name = 'Upper A (heavy)' where id = 'c5000000-0000-0000-0000-0000000000d1' $$,
  '3a. an active coach edits a day');
select lives_ok($$ insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps)
                   values ('c5000000-0000-0000-0000-0000000000d1', 'c5000000-0000-0000-0000-0000000000ee', 1, 4, '6') $$,
  '3a. adds an exercise');
select lives_ok($$ update public.planned_meals set name = 'Oats & berries' where id = 'c5000000-0000-0000-0000-0000000000e9' $$,
  '3a. edits a meal');
select lives_ok($$ insert into public.planned_meal_foods (planned_meal_id, food_id, grams)
                   values ('c5000000-0000-0000-0000-0000000000e9', 'c5000000-0000-0000-0000-0000000000ff', 80) $$,
  '3a. adds a food to it');
select pg_temp.attempt($$delete from public.programs where id = 'c5000000-0000-0000-0000-0000000000b3'$$);
reset role;
select is((select count(*)::int from public.program_exercises where program_day_id = 'c5000000-0000-0000-0000-0000000000d1'), 2,
  '3a. the exercise landed');
select is((select count(*)::int from public.planned_meal_foods where planned_meal_id = 'c5000000-0000-0000-0000-0000000000e9'), 1,
  '3a. the food landed');
select is((select count(*)::int from public.programs where id = 'c5000000-0000-0000-0000-0000000000b3'), 0,
  '3a. an active coach may delete a published program');

-- 3b. the coach ends the coaching with m2
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select is(public.coaching_transition('c5000000-0000-0000-0000-0000000000a2', 'ended'), 'ended', '3b. the coach ends the coaching');
select is((select count(*)::int from public.programs where client_id = 'c5000000-0000-0000-0000-000000000012'), 2,
  '3b. the ex-coach still reads the programs they wrote');
select is((select count(*)::int from public.planned_meals where id = 'c5000000-0000-0000-0000-0000000000e9'), 1,
  '3b. and the meals');
select throws_ok($$ insert into public.program_days (program_id, day_index, name)
                    values ('c5000000-0000-0000-0000-0000000000b1', 2, 'Sneaky') $$,
  '42501', null, '3b. the ex-coach cannot add a day to the client''s program');
select throws_ok($$ insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps)
                    values ('c5000000-0000-0000-0000-0000000000d1', 'c5000000-0000-0000-0000-0000000000ee', 9, 4, '9') $$,
  '42501', null, '3b. nor an exercise');
select throws_ok($$ select public.duplicate_program_exercise('c5000000-0000-0000-0000-00000000007a') $$,
  '42501', null, '3b. nor duplicate one through the RPC');
select throws_ok($$ insert into public.planned_meals (plan_id, slot, name)
                    values ('c5000000-0000-0000-0000-0000000000e1', 'lunch', 'Sneaky') $$,
  '42501', null, '3b. nor a meal to the client''s plan');
select throws_ok($$ insert into public.planned_meal_foods (planned_meal_id, food_id, grams)
                    values ('c5000000-0000-0000-0000-0000000000e9', 'c5000000-0000-0000-0000-0000000000ff', 500) $$,
  '42501', null, '3b. nor a food to a meal');
-- updates and deletes RLS filters to zero rows (the app's mutated() reports them)
select pg_temp.attempt($$update public.program_days set name = 'gone' where id = 'c5000000-0000-0000-0000-0000000000d1'$$);
select pg_temp.attempt($$update public.program_exercises set target_sets = 5 where id = 'c5000000-0000-0000-0000-00000000007a'$$);
select pg_temp.attempt($$update public.planned_meals set name = 'gone' where id = 'c5000000-0000-0000-0000-0000000000e9'$$);
select pg_temp.attempt($$delete from public.planned_meal_foods where planned_meal_id = 'c5000000-0000-0000-0000-0000000000e9'$$);
select pg_temp.attempt($$update public.programs set name = 'gone' where id = 'c5000000-0000-0000-0000-0000000000b1'$$);
select pg_temp.attempt($$delete from public.programs where id = 'c5000000-0000-0000-0000-0000000000b1'$$);
select pg_temp.attempt($$delete from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e1'$$);
-- a draft the client never saw may still be cleaned up
select pg_temp.attempt($$delete from public.programs where id = 'c5000000-0000-0000-0000-0000000000b2'$$);
select pg_temp.attempt($$delete from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e2'$$);
reset role;
select is((select name from public.program_days where id = 'c5000000-0000-0000-0000-0000000000d1'), 'Upper A (heavy)',
  '3b. the ex-coach could not rename the client''s day');
select is((select target_sets from public.program_exercises where id = 'c5000000-0000-0000-0000-00000000007a'), 3,
  '3b. nor change an exercise');
select is((select name from public.planned_meals where id = 'c5000000-0000-0000-0000-0000000000e9'), 'Oats & berries',
  '3b. nor the client''s meal');
select is((select count(*)::int from public.planned_meal_foods where planned_meal_id = 'c5000000-0000-0000-0000-0000000000e9'), 1,
  '3b. nor remove its food');
select is((select name from public.programs where id = 'c5000000-0000-0000-0000-0000000000b1'), 'Strength',
  '3b. nor rename the program');
select is((select count(*)::int from public.programs where id = 'c5000000-0000-0000-0000-0000000000b1'), 1,
  '3b. nor delete the client''s published program');
select is((select count(*)::int from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e1'), 1,
  '3b. nor the client''s published nutrition plan');
select is((select count(*)::int from public.programs where id = 'c5000000-0000-0000-0000-0000000000b2'), 0,
  '3b. but an unsent draft program can be deleted');
select is((select count(*)::int from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e2'), 0,
  '3b. and an unsent draft plan');

-- 3c. a paused coaching pauses the writes too (is_active_coach_of is active-only)
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select is(public.coaching_transition('c5000000-0000-0000-0000-0000000000a1', 'paused', 'vacation'), 'paused', '3c. m1 pauses');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.planned_meals (plan_id, slot, name)
                    values ('c5000000-0000-0000-0000-0000000000e4', 'dinner', 'Sneaky') $$,
  '42501', null, '3c. the paused coach cannot add a meal');
select pg_temp.attempt($$update public.program_days set name = 'gone' where id = 'c5000000-0000-0000-0000-0000000000d4'$$);
select pg_temp.attempt($$update public.planned_meals set name = 'gone' where id = 'c5000000-0000-0000-0000-0000000000e8'$$);
select pg_temp.attempt($$delete from public.programs where id = 'c5000000-0000-0000-0000-0000000000b4'$$);
select pg_temp.attempt($$delete from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e4'$$);
reset role;
select is((select name from public.program_days where id = 'c5000000-0000-0000-0000-0000000000d4'), 'Full body',
  '3c. the paused coach could not rename a day');
select is((select name from public.planned_meals where id = 'c5000000-0000-0000-0000-0000000000e8'), 'Rice bowl',
  '3c. nor a meal');
select is((select count(*)::int from public.programs where id = 'c5000000-0000-0000-0000-0000000000b4'), 1,
  '3c. nor delete the published program');
select is((select count(*)::int from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e4'), 1,
  '3c. nor the published plan');

-- 3d. the client's own side: read the coach's plan, never write it; own plans stay theirs
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000012');
select pg_temp.attempt($$update public.planned_meals set name = 'client edit' where id = 'c5000000-0000-0000-0000-0000000000e9'$$);
select is((select count(*)::int from public.planned_meals where id = 'c5000000-0000-0000-0000-0000000000e9'), 1,
  '3d. the client reads the coach''s published meal');
select lives_ok($$ insert into public.nutrition_plans (id, coach_id, client_id, name, status, kcal_target, protein_target_g)
                   values ('c5000000-0000-0000-0000-0000000000e5', null, auth.uid(), 'My own', 'published', 2100, 140) $$,
  '3d. a client without a coach creates their own plan');
select lives_ok($$ insert into public.planned_meals (plan_id, slot, name) values ('c5000000-0000-0000-0000-0000000000e5', 'dinner', 'Soup') $$,
  '3d. and its meals');
-- programs.id is not in the insert grant: the database makes it, as createSoloProgram relies on
select lives_ok($$ insert into public.programs (coach_id, client_id, name, status)
                   values (null, auth.uid(), 'WS Mine', 'published') $$,
  '3d. and their own program');
select lives_ok($$ insert into public.program_days (program_id, day_index, name)
                   select id, 1, 'Legs' from public.programs where name = 'WS Mine' and client_id = auth.uid() $$,
  '3d. with its days');
reset role;
select is((select name from public.planned_meals where id = 'c5000000-0000-0000-0000-0000000000e9'), 'Oats & berries',
  '3d. the client could not rewrite the coach''s meal');

-- ============================================================================
-- 4. a set is filed only under the logger's own session
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000012');
select lives_ok($$ insert into public.logged_sets (id, session_id, user_id, exercise_id, set_index, weight_kg, reps, client_generated_id)
                   values ('c5000000-0000-0000-0000-0000000005b1', 'c5000000-0000-0000-0000-0000000005a2', auth.uid(),
                           'c5000000-0000-0000-0000-0000000000ee', 1, 100, 5, gen_random_uuid()) $$,
  '4. a set goes into the logger''s own session');
select lives_ok($$ update public.logged_sets set reps = 6 where id = 'c5000000-0000-0000-0000-0000000005b1' $$,
  '4. and can be corrected there');
select throws_ok($$ insert into public.logged_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, client_generated_id)
                    values ('c5000000-0000-0000-0000-0000000005a1', auth.uid(), 'c5000000-0000-0000-0000-0000000000ee', 1, 500, 10, gen_random_uuid()) $$,
  '42501', null, '4. but not into another person''s session');
select throws_ok($$ update public.logged_sets set session_id = 'c5000000-0000-0000-0000-0000000005a1'
                    where id = 'c5000000-0000-0000-0000-0000000005b1' $$,
  '42501', null, '4. nor moved into one afterwards');
reset role;
select is((select count(*)::int from public.logged_sets
            where session_id = 'c5000000-0000-0000-0000-0000000005a1' and user_id <> 'c5000000-0000-0000-0000-000000000011'), 0,
  '4. the other person''s session holds only their own sets');

-- ============================================================================
-- 5. macro targets are never negative (nutrition_plans_macro_targets_check)
-- ============================================================================
select throws_ok($$ insert into public.nutrition_plans (coach_id, client_id, name, kcal_target, protein_target_g)
                    values (null, 'c5000000-0000-0000-0000-000000000013', 'Bad', 2000, -50) $$,
  '23514', null, '5. a negative protein target is refused by the table itself');
select throws_ok($$ update public.nutrition_plans set fat_target_g = 5000 where id = 'c5000000-0000-0000-0000-0000000000e1' $$,
  '23514', null, '5. and so is an absurd one on update');
select lives_ok($$ update public.nutrition_plans set protein_target_g = 0, carbs_target_g = 2500, fat_target_g = 1111
                   where id = 'c5000000-0000-0000-0000-0000000000e1' $$,
  '5. the edges are accepted: 10 000 kcal all carbs, or all fat, is a target the app can derive');

-- ============================================================================
-- 6. a habit is ticked only by the person whose habit it is
-- ============================================================================
-- c1 created the habit and is now paused; s is a stranger. Neither may tick it —
-- before 20261122100000 either could, and the unique (habit_id, date) then
-- refused m1's own tick for that day on a row m1 cannot see.
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.habit_logs (habit_id, user_id, date, client_generated_id)
                    values ('c5000000-0000-0000-0000-00000000007b', auth.uid(), current_date, gen_random_uuid()) $$,
  '42501', null, '6. the coach who set the habit cannot tick it for the client''s day');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000013');
select throws_ok($$ insert into public.habit_logs (habit_id, user_id, date, client_generated_id)
                    values ('c5000000-0000-0000-0000-00000000007b', auth.uid(), current_date, gen_random_uuid()) $$,
  '42501', null, '6. nor can a stranger');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select lives_ok($$ insert into public.habit_logs (habit_id, user_id, date, client_generated_id)
                   values ('c5000000-0000-0000-0000-00000000007b', auth.uid(), current_date, gen_random_uuid()) $$,
  '6. the client ticks their coach-set habit');
select lives_ok($$ delete from public.habit_logs where habit_id = 'c5000000-0000-0000-0000-00000000007b' and date = current_date $$,
  '6. and un-ticks it');
reset role;
select is((select count(*)::int from public.habit_logs where habit_id = 'c5000000-0000-0000-0000-00000000007b'), 0,
  '6. no tick left behind by anyone');

-- ============================================================================
-- 8. a session / set / video points only at what the logger may use
-- ============================================================================
-- a public routine by the other coach, for the "may log against what you can see" path
insert into public.programs (id, coach_id, client_id, name, status, visibility) values
  ('c5000000-0000-0000-0000-0000000000b6', null, 'c5000000-0000-0000-0000-000000000002', 'Public routine', 'published', 'public');
insert into public.program_days (id, program_id, day_index, name) values
  ('c5000000-0000-0000-0000-0000000000d6', 'c5000000-0000-0000-0000-0000000000b6', 1, 'Full body');
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000013');
select throws_ok($$ insert into public.logged_sessions (user_id, program_day_id, started_at, client_generated_id)
                    values (auth.uid(), 'c5000000-0000-0000-0000-0000000000d1', now(), gen_random_uuid()) $$,
  '42501', null, '8. a stranger cannot file a session under another person''s private program day');
select lives_ok($$ insert into public.logged_sessions (id, user_id, program_day_id, started_at, client_generated_id)
                   values ('c5000000-0000-0000-0000-0000000005a3', auth.uid(), 'c5000000-0000-0000-0000-0000000000d6', now(), gen_random_uuid()) $$,
  '8. but may log a public routine''s day');
select throws_ok($$ insert into public.logged_sets (session_id, user_id, exercise_id, program_exercise_id, set_index, weight_kg, reps, client_generated_id)
                    values ('c5000000-0000-0000-0000-0000000005a3', auth.uid(), 'c5000000-0000-0000-0000-0000000000ee',
                            'c5000000-0000-0000-0000-00000000007a', 1, 60, 5, gen_random_uuid()) $$,
  '42501', null, '8. nor a set under another person''s private program exercise');
select throws_ok($$ insert into public.set_videos (logged_set_id, user_id, storage_path)
                    values ('c5000000-0000-0000-0000-0000000005b0', auth.uid(), 'videos/not-mine.mp4') $$,
  '42501', null, '8. nor a video under another person''s set');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000012');
select lives_ok($$ insert into public.logged_sessions (user_id, program_day_id, started_at, client_generated_id)
                   values (auth.uid(), 'c5000000-0000-0000-0000-0000000000d1', now(), gen_random_uuid()) $$,
  '8. the client logs a day of the program their (former) coach wrote for them');
select lives_ok($$ insert into public.set_videos (logged_set_id, user_id, storage_path)
                   values ('c5000000-0000-0000-0000-0000000005b1', auth.uid(), 'videos/m2.mp4') $$,
  '8. and films their own set');
reset role;
select is((select count(*)::int from public.logged_sessions where program_day_id = 'c5000000-0000-0000-0000-0000000000d1'
            and user_id <> 'c5000000-0000-0000-0000-000000000012'), 0,
  '8. the private day carries only its own client''s sessions');

-- ============================================================================
-- 7. admin_set_tier: no anonymous caller; signed-in non-admins refused inside
-- ============================================================================
select ok(not has_function_privilege('anon', 'public.admin_set_tier(uuid, text)', 'execute'),
  '7. anon cannot execute admin_set_tier');
select ok(has_function_privilege('authenticated', 'public.admin_set_tier(uuid, text)', 'execute')
          and has_function_privilege('service_role', 'public.admin_set_tier(uuid, text)', 'execute'),
  '7. a signed-in caller and the service role still can');
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select throws_ok($$ select public.admin_set_tier('c5000000-0000-0000-0000-000000000011', 'premium') $$,
  'P0001', 'FORBIDDEN', '7. a client cannot give themselves premium');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000099');
select lives_ok($$ select public.admin_set_tier('c5000000-0000-0000-0000-000000000011', 'premium') $$,
  '7. an admin sets a tier');
reset role;
select is((select tier from public.subscriptions where user_id = 'c5000000-0000-0000-0000-000000000011'), 'premium',
  '7. and it lands');

select * from finish();
rollback;
