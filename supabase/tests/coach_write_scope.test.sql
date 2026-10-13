-- pgTAP · coach and client writes stay inside the columns and the relationship
-- they exist for (20261121100000_coach_write_scope).
--
-- Every "cannot" below was a "can" before that migration: a client rewriting
-- (and re-attributing) a coach's feedback, a coach rewriting a client's
-- check-in, and a coach who ended — or paused — the coaching deleting or
-- editing the client's program and nutrition plan.

begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures ----------
-- c1 coaches m1 (active) and m2 (ended below); c2 is an unrelated coach.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c5000000-0000-0000-0000-000000000001', 'ws-coach@test.local',  '{}'),
  ('c5000000-0000-0000-0000-000000000002', 'ws-other@test.local',  '{}'),
  ('c5000000-0000-0000-0000-000000000011', 'ws-maria@test.local',  '{}'),
  ('c5000000-0000-0000-0000-000000000012', 'ws-andrei@test.local', '{}');
update public.users set role = 'coach'
 where id in ('c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002');

insert into public.trainer_clients (id, coach_id, client_id, status, started_at) values
  ('c5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000011', 'active', now()),
  ('c5000000-0000-0000-0000-0000000000a2', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'active', now());

insert into public.check_ins (id, user_id, week_start, weight_kg, energy, note) values
  ('c5000000-0000-0000-0000-0000000000c1', 'c5000000-0000-0000-0000-000000000011', current_date, 70.0, 3, 'tired');
insert into public.coach_feedback (id, coach_id, client_id, reference_type, reference_id, body) values
  ('c5000000-0000-0000-0000-0000000000f1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000011',
   'check_in', 'c5000000-0000-0000-0000-0000000000c1', 'Solid week');

-- m2's published program and nutrition plan, plus a draft of each
insert into public.programs (id, coach_id, client_id, name, status) values
  ('c5000000-0000-0000-0000-0000000000b1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Strength', 'published'),
  ('c5000000-0000-0000-0000-0000000000b2', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Unsent', 'draft');
insert into public.program_days (id, program_id, day_index, name) values
  ('c5000000-0000-0000-0000-0000000000d1', 'c5000000-0000-0000-0000-0000000000b1', 1, 'Upper A');
insert into public.nutrition_plans (id, coach_id, client_id, name, status, kcal_target) values
  ('c5000000-0000-0000-0000-0000000000e1', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Cut', 'published', 2000),
  ('c5000000-0000-0000-0000-0000000000e2', 'c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000012', 'Unsent', 'draft', 1800);
insert into public.planned_meals (id, plan_id, slot, name) values
  ('c5000000-0000-0000-0000-0000000000e9', 'c5000000-0000-0000-0000-0000000000e1', 'breakfast', 'Oats');

-- ============================================================================
-- 1. coach_feedback: the client marks it read and changes nothing else
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select lives_ok($$ update public.coach_feedback set read_at = now() where id = 'c5000000-0000-0000-0000-0000000000f1' $$,
  'the client marks their feedback read');
select throws_ok($$ update public.coach_feedback set body = 'You are the best client ever' where id = 'c5000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'the client cannot rewrite what the coach wrote');
select throws_ok($$ update public.coach_feedback set coach_id = 'c5000000-0000-0000-0000-000000000002' where id = 'c5000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'nor hand the feedback to another coach');
reset role;
select is((select body from public.coach_feedback where id = 'c5000000-0000-0000-0000-0000000000f1'), 'Solid week',
  'the feedback is the coach''s words');
select isnt((select read_at from public.coach_feedback where id = 'c5000000-0000-0000-0000-0000000000f1'), null,
  'and it is marked read');
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.coach_feedback), 0, 'the other coach still sees no feedback under their name');
reset role;

-- ============================================================================
-- 2. check_ins: the coach stamps the review, the client's answers are theirs
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.check_ins set coach_reviewed_at = now() where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  'the coach marks the check-in reviewed');
select throws_ok($$ update public.check_ins set weight_kg = 95 where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  '42501', 'REVIEW_ONLY', 'the coach cannot change the client''s weight');
select throws_ok($$ update public.check_ins set note = 'all good', coach_reviewed_at = now() where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  '42501', 'REVIEW_ONLY', 'nor their note, even alongside the review stamp');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.check_ins), 0, 'an unrelated coach does not see the check-in');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select lives_ok($$ update public.check_ins set note = 'tired, slept badly' where id = 'c5000000-0000-0000-0000-0000000000c1' $$,
  'the client still edits their own check-in');
reset role;
select is((select weight_kg::numeric from public.check_ins where id = 'c5000000-0000-0000-0000-0000000000c1'), 70.0::numeric,
  'the weight is what the client entered');
select is((select note from public.check_ins where id = 'c5000000-0000-0000-0000-0000000000c1'), 'tired, slept badly',
  'the note is the client''s');
select isnt((select coach_reviewed_at from public.check_ins where id = 'c5000000-0000-0000-0000-0000000000c1'), null,
  'and the review stamp stuck');

-- ============================================================================
-- 3. the coach's reach into a plan ends with the coaching
-- ============================================================================
-- while coaching: everything works (the regression guard for the fix itself)
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.program_days set name = 'Upper A (heavy)' where id = 'c5000000-0000-0000-0000-0000000000d1' $$,
  'an active coach edits a day');
select is((select name from public.program_days where id = 'c5000000-0000-0000-0000-0000000000d1'), 'Upper A (heavy)',
  'and the edit lands');
select lives_ok($$ update public.planned_meals set name = 'Oats & berries' where id = 'c5000000-0000-0000-0000-0000000000e9' $$,
  'an active coach edits a meal');

-- the coach ends it
select is(public.coaching_transition('c5000000-0000-0000-0000-0000000000a2', 'ended'), 'ended', 'the coach ends the coaching');

-- reads of their own work stay
select is((select count(*)::int from public.programs where client_id = 'c5000000-0000-0000-0000-000000000012'), 2,
  'the ex-coach still reads the programs they wrote');
select is((select count(*)::int from public.planned_meals where id = 'c5000000-0000-0000-0000-0000000000e9'), 1,
  'and the meals');

select throws_ok($$ insert into public.program_days (program_id, day_index, name)
                    values ('c5000000-0000-0000-0000-0000000000b1', 2, 'Sneaky') $$,
  '42501', null, 'the ex-coach cannot add a day to the client''s program');
select throws_ok($$ insert into public.planned_meals (plan_id, slot, name)
                    values ('c5000000-0000-0000-0000-0000000000e1', 'lunch', 'Sneaky') $$,
  '42501', null, 'nor a meal to the client''s plan');
-- writes are gone (RLS filters them: zero rows, which the app's mutated() reports)
update public.program_days set name = 'gone' where id = 'c5000000-0000-0000-0000-0000000000d1';
update public.planned_meals set name = 'gone' where id = 'c5000000-0000-0000-0000-0000000000e9';
delete from public.programs where id = 'c5000000-0000-0000-0000-0000000000b1';
delete from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e1';
-- a draft the client never saw may still be cleaned up
delete from public.programs where id = 'c5000000-0000-0000-0000-0000000000b2';
delete from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e2';
reset role;

select is((select name from public.program_days where id = 'c5000000-0000-0000-0000-0000000000d1'), 'Upper A (heavy)',
  'the ex-coach could not rename the client''s day');
select is((select name from public.planned_meals where id = 'c5000000-0000-0000-0000-0000000000e9'), 'Oats & berries',
  'nor the client''s meal');
select is((select count(*)::int from public.programs where id = 'c5000000-0000-0000-0000-0000000000b1'), 1,
  'nor delete the client''s published program');
select is((select count(*)::int from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e1'), 1,
  'nor the client''s published nutrition plan');
select is((select count(*)::int from public.programs where id = 'c5000000-0000-0000-0000-0000000000b2'), 0,
  'but an unsent draft program can be deleted');
select is((select count(*)::int from public.nutrition_plans where id = 'c5000000-0000-0000-0000-0000000000e2'), 0,
  'and an unsent draft plan');

-- a paused coaching pauses the writes too (is_active_coach_of is active-only)
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000011');
select is(public.coaching_transition('c5000000-0000-0000-0000-0000000000a1', 'paused', 'vacation'), 'paused', 'the client pauses');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
update public.check_ins set coach_reviewed_at = null where id = 'c5000000-0000-0000-0000-0000000000c1';
reset role;
select isnt((select coach_reviewed_at from public.check_ins where id = 'c5000000-0000-0000-0000-0000000000c1'), null,
  'a paused coach no longer reaches the client''s check-in');

-- ============================================================================
-- 4. a set is filed only under the logger's own session
-- ============================================================================
insert into public.exercises (id, name_en) values ('c5000000-0000-0000-0000-0000000000ee', 'WS Squat');
insert into public.logged_sessions (id, user_id, started_at, completed_at, client_generated_id) values
  ('c5000000-0000-0000-0000-0000000005a1', 'c5000000-0000-0000-0000-000000000011', now() - interval '1 hour', now(), gen_random_uuid()),
  ('c5000000-0000-0000-0000-0000000005a2', 'c5000000-0000-0000-0000-000000000012', now() - interval '1 hour', null, gen_random_uuid());
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000012');
select lives_ok($$ insert into public.logged_sets (id, session_id, user_id, exercise_id, set_index, weight_kg, reps, client_generated_id)
                   values ('c5000000-0000-0000-0000-0000000005b1', 'c5000000-0000-0000-0000-0000000005a2', auth.uid(),
                           'c5000000-0000-0000-0000-0000000000ee', 1, 100, 5, gen_random_uuid()) $$,
  'a set goes into the logger''s own session');
select throws_ok($$ insert into public.logged_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, client_generated_id)
                    values ('c5000000-0000-0000-0000-0000000005a1', auth.uid(), 'c5000000-0000-0000-0000-0000000000ee', 1, 500, 10, gen_random_uuid()) $$,
  '42501', null, 'but not into another person''s session');
select throws_ok($$ update public.logged_sets set session_id = 'c5000000-0000-0000-0000-0000000005a1'
                    where id = 'c5000000-0000-0000-0000-0000000005b1' $$,
  '42501', null, 'nor moved into one afterwards');
reset role;
select is((select count(*)::int from public.logged_sets where session_id = 'c5000000-0000-0000-0000-0000000005a1'), 0,
  'the other person''s session holds only their own sets');

-- ============================================================================
-- 5. macro targets are never negative (nutrition_plans_macro_targets_check)
-- ============================================================================
select throws_ok($$ insert into public.nutrition_plans (coach_id, client_id, name, kcal_target, protein_target_g)
                    values (null, 'c5000000-0000-0000-0000-000000000011', 'Bad', 2000, -50) $$,
  '23514', null, 'a negative protein target is refused by the table itself');
select throws_ok($$ update public.nutrition_plans set fat_target_g = 5000 where id = 'c5000000-0000-0000-0000-0000000000e1' $$,
  '23514', null, 'and so is an absurd one on update');

select * from finish();
rollback;
