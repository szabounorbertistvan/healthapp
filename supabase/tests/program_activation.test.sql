-- pgTAP · program activation and program-builder integrity
-- (20261125100000_program_activation.sql, with the builder rules it leans on):
--
--   1. who may stamp activated_at — the solo owner, the coach while coaching;
--      never a coached client on the coach's plan, never a stranger
--   2. activating writes nothing else: no session, no set, no day
--   3. a duplicate (copy_program) is an independent copy that starts unactivated
--   4. editing a program never rewrites history: logged sets keep their own
--      numbers when the prescription changes, and survive (unlinked) when the
--      prescribed exercise, the day or the program is deleted
--   5. reordering exercises keeps every row, and adding/removing changes only its own row
--
-- Run with a local stack up:  npm run db:test   (or offline: npm run db:test:offline program_activation)

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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
  ('c7000000-0000-0000-0000-000000000001', 'pa-coach@test.local',    '{"full_name":"Coach","username":"pacoach"}'),
  ('c7000000-0000-0000-0000-000000000011', 'pa-coached@test.local',  '{"full_name":"Coached","username":"pacoached"}'),
  ('c7000000-0000-0000-0000-000000000012', 'pa-solo@test.local',     '{"full_name":"Solo","username":"pasolo"}'),
  ('c7000000-0000-0000-0000-000000000013', 'pa-stranger@test.local', '{"full_name":"Stranger","username":"pastranger"}');
update public.users set role = 'coach' where id = 'c7000000-0000-0000-0000-000000000001';
insert into public.trainer_clients (id, coach_id, client_id, status, started_at) values
  ('c7000000-0000-0000-0000-0000000000a1', 'c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000011', 'active', now());

insert into public.exercises (id, name_en) values
  ('c7000000-0000-0000-0000-0000000000e1', 'PA Bench'),
  ('c7000000-0000-0000-0000-0000000000e2', 'PA Row'),
  ('c7000000-0000-0000-0000-0000000000e3', 'PA Squat');

-- the solo client's two published blocks (A older), the coach's two blocks for the coached client
insert into public.programs (id, coach_id, client_id, name, status, updated_at) values
  ('c7000000-0000-0000-0000-0000000001a1', null, 'c7000000-0000-0000-0000-000000000012', 'Block A', 'published', now() - interval '10 days'),
  ('c7000000-0000-0000-0000-0000000001a2', null, 'c7000000-0000-0000-0000-000000000012', 'Block B', 'published', now() - interval '5 days'),
  ('c7000000-0000-0000-0000-0000000001c1', 'c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000011', 'Coach block 1', 'published', now() - interval '3 days'),
  ('c7000000-0000-0000-0000-0000000001c2', 'c7000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-000000000011', 'Coach block 2', 'published', now() - interval '1 day'),
  ('c7000000-0000-0000-0000-0000000001d1', null, 'c7000000-0000-0000-0000-000000000013', 'Stranger plan', 'published', now());
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('c7000000-0000-0000-0000-0000000002a1', 'c7000000-0000-0000-0000-0000000001a1', 1, 0, 'Upper'),
  ('c7000000-0000-0000-0000-0000000002a2', 'c7000000-0000-0000-0000-0000000001a1', 1, 1, 'Lower');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds) values
  ('c7000000-0000-0000-0000-0000000003a1', 'c7000000-0000-0000-0000-0000000002a1', 'c7000000-0000-0000-0000-0000000000e1', 0, 4, '8', 2, 120),
  ('c7000000-0000-0000-0000-0000000003a2', 'c7000000-0000-0000-0000-0000000002a1', 'c7000000-0000-0000-0000-0000000000e2', 1, 3, '10', 2, 90),
  ('c7000000-0000-0000-0000-0000000003a3', 'c7000000-0000-0000-0000-0000000002a2', 'c7000000-0000-0000-0000-0000000000e3', 0, 5, '5', 1, 180);

-- a finished Upper session: two sets of bench, logged against the prescription
insert into public.logged_sessions (id, user_id, program_day_id, client_generated_id, started_at, completed_at) values
  ('c7000000-0000-0000-0000-0000000004a1', 'c7000000-0000-0000-0000-000000000012', 'c7000000-0000-0000-0000-0000000002a1',
   gen_random_uuid(), now() - interval '2 days', now() - interval '2 days' + interval '1 hour');
insert into public.logged_sets (id, session_id, user_id, program_exercise_id, exercise_id, client_generated_id, set_index, reps, weight_kg) values
  ('c7000000-0000-0000-0000-0000000005a1', 'c7000000-0000-0000-0000-0000000004a1', 'c7000000-0000-0000-0000-000000000012',
   'c7000000-0000-0000-0000-0000000003a1', 'c7000000-0000-0000-0000-0000000000e1', gen_random_uuid(), 1, 8, 80),
  ('c7000000-0000-0000-0000-0000000005a2', 'c7000000-0000-0000-0000-0000000004a1', 'c7000000-0000-0000-0000-000000000012',
   'c7000000-0000-0000-0000-0000000003a1', 'c7000000-0000-0000-0000-0000000000e1', gen_random_uuid(), 2, 7, 82.5);

-- ============================================================
-- 1. who may activate
-- ============================================================
select has_column('public', 'programs', 'activated_at', '1a. programs has activated_at');
select is((select count(*)::int from public.programs where activated_at is not null), 0,
  '1b. nothing is backfilled: no existing row was activated by the migration');

select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
select is(
  pg_temp.touched($$ update public.programs set activated_at = now() where id = 'c7000000-0000-0000-0000-0000000001a1' $$),
  1, '1c. the solo owner activates their older block');
select is(
  pg_temp.touched($$ update public.programs set activated_at = now() where id = 'c7000000-0000-0000-0000-0000000001d1' $$),
  0, '1d. a stranger''s program cannot be activated (RLS filters it out)');
select is(
  pg_temp.touched($$ update public.programs set activated_at = now() where id = 'c7000000-0000-0000-0000-0000000001c1' $$),
  0, '1e. nor someone else''s coach plan');

select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000011');
select is(
  pg_temp.touched($$ update public.programs set activated_at = now() where id = 'c7000000-0000-0000-0000-0000000001c1' $$),
  0, '1f. a coached client cannot re-point their coach''s plan');

select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000001');
select is(
  pg_temp.touched($$ update public.programs set activated_at = now() where id = 'c7000000-0000-0000-0000-0000000001c1' $$),
  1, '1g. the coach activates block 1 for their client');
reset role;

-- the coach ends the coaching: the stamp is theirs no longer
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000001');
select is(public.coaching_transition('c7000000-0000-0000-0000-0000000000a1', 'ended'), 'ended', '1h. the coach ends the coaching');
select is(
  pg_temp.touched($$ update public.programs set activated_at = now() where id = 'c7000000-0000-0000-0000-0000000001c2' $$),
  0, '1i. after the coaching ended the former coach cannot activate the client''s plan');
reset role;

-- ============================================================
-- 2. activation writes nothing else
-- ============================================================
select is((select count(*)::int from public.logged_sessions where user_id = 'c7000000-0000-0000-0000-000000000012'), 1,
  '2a. activating created no session');
select is((select count(*)::int from public.logged_sets where user_id = 'c7000000-0000-0000-0000-000000000012'), 2,
  '2b. nor any set');
select is((select count(*)::int from public.program_days where program_id = 'c7000000-0000-0000-0000-0000000001a1'), 2,
  '2c. nor any day');
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
select lives_ok($$ update public.programs set activated_at = now() where id = 'c7000000-0000-0000-0000-0000000001a1' $$,
  '2d. activating twice is harmless');
reset role;
select is((select count(*)::int from public.logged_sessions where user_id = 'c7000000-0000-0000-0000-000000000012'), 1,
  '2e. and still creates no session');

-- ============================================================
-- 3. a duplicate is independent and unactivated
-- ============================================================
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
create temp table pa_copy on commit drop as
  select public.copy_program('c7000000-0000-0000-0000-0000000001a1', 'Block A (copy)') as id;
reset role;
select is((select activated_at from public.programs where id = (select id from pa_copy)), null::timestamptz,
  '3a. the copy starts unactivated — copying never changes what is followed');
select ok((select activated_at is not null from public.programs where id = 'c7000000-0000-0000-0000-0000000001a1'),
  '3b. the original keeps its activation');
select is((select count(*)::int from public.program_exercises pe join public.program_days d on d.id = pe.program_day_id
           where d.program_id = (select id from pa_copy)), 3,
  '3c. the copy carries every prescribed exercise');
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
update public.program_exercises set target_sets = 6
 where program_day_id in (select id from public.program_days where program_id = (select id from pa_copy));
reset role;
select is((select target_sets from public.program_exercises where id = 'c7000000-0000-0000-0000-0000000003a1'), 4,
  '3d. editing the copy leaves the original''s prescription alone');
select is((select count(*)::int from public.logged_sessions where user_id = 'c7000000-0000-0000-0000-000000000012'), 1,
  '3e. duplicating created no session');

-- ============================================================
-- 4. editing never rewrites history
-- ============================================================
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
update public.program_exercises set target_sets = 5, target_reps = '5', target_weight_kg = 100
 where id = 'c7000000-0000-0000-0000-0000000003a1';
reset role;
select is((select string_agg(reps || 'x' || weight_kg, ',' order by set_index) from public.logged_sets
           where session_id = 'c7000000-0000-0000-0000-0000000004a1'), '8x80.00,7x82.50',
  '4a. a changed prescription leaves the logged sets as they were');

select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
select lives_ok($$ delete from public.program_exercises where id = 'c7000000-0000-0000-0000-0000000003a1' $$,
  '4b. the owner removes the prescribed bench');
reset role;
select is((select count(*)::int from public.logged_sets where session_id = 'c7000000-0000-0000-0000-0000000004a1'), 2,
  '4c. both logged sets survive the removal');
select is((select count(*)::int from public.logged_sets where session_id = 'c7000000-0000-0000-0000-0000000004a1' and program_exercise_id is null), 2,
  '4d. only their link to the prescription is cut');

select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
select lives_ok($$ delete from public.programs where id = 'c7000000-0000-0000-0000-0000000001a1' $$,
  '4e. the owner deletes the whole program');
reset role;
select is((select count(*)::int from public.logged_sessions where id = 'c7000000-0000-0000-0000-0000000004a1' and program_day_id is null), 1,
  '4f. the finished session survives, unlinked from the deleted day');
select is((select count(*)::int from public.logged_sets where session_id = 'c7000000-0000-0000-0000-0000000004a1'), 2,
  '4g. with every set and its numbers');

-- ============================================================
-- 5. add, reorder, remove inside a day touch only their own rows
-- ============================================================
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('c7000000-0000-0000-0000-0000000002b1', 'c7000000-0000-0000-0000-0000000001a2', 1, 0, 'Full body');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps) values
  ('c7000000-0000-0000-0000-0000000003b1', 'c7000000-0000-0000-0000-0000000002b1', 'c7000000-0000-0000-0000-0000000000e1', 0, 3, '8'),
  ('c7000000-0000-0000-0000-0000000003b2', 'c7000000-0000-0000-0000-0000000002b1', 'c7000000-0000-0000-0000-0000000000e2', 1, 3, '10'),
  ('c7000000-0000-0000-0000-0000000003b3', 'c7000000-0000-0000-0000-0000000002b1', 'c7000000-0000-0000-0000-0000000000e3', 2, 3, '5');
-- the builder's move: swap two neighbours' positions
update public.program_exercises set position = case id
    when 'c7000000-0000-0000-0000-0000000003b1' then 1
    when 'c7000000-0000-0000-0000-0000000003b2' then 0 end
 where id in ('c7000000-0000-0000-0000-0000000003b1', 'c7000000-0000-0000-0000-0000000003b2');
reset role;
select is((select string_agg(exercise_id::text, ',' order by position) from public.program_exercises
           where program_day_id = 'c7000000-0000-0000-0000-0000000002b1'),
  'c7000000-0000-0000-0000-0000000000e2,c7000000-0000-0000-0000-0000000000e1,c7000000-0000-0000-0000-0000000000e3',
  '5a. the reorder is stored and read back in the new order');
select is((select count(*)::int from public.program_exercises where program_day_id = 'c7000000-0000-0000-0000-0000000002b1'), 3,
  '5b. reordering neither drops nor duplicates a row');
select pg_temp.authenticate_as('c7000000-0000-0000-0000-000000000012');
delete from public.program_exercises where id = 'c7000000-0000-0000-0000-0000000003b3';
reset role;
select is((select count(*)::int from public.program_exercises where program_day_id = 'c7000000-0000-0000-0000-0000000002b1'), 2,
  '5c. removing one exercise removes exactly that one');

select * from finish();
rollback;
