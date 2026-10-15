-- pgTAP · the rows the progression analysis reads (lib/exercise-analytics-data:
-- getExerciseHistory / getProgressionOverview — logged_sets with the completed
-- session and the prescription it was logged against). No migration: these
-- are the existing policies, pinned for the new read shape.
--
--   1. a person reads their own sets with the prescription's set_type (warm-up or not)
--   2. a stranger reads none of them, whatever exercise id they ask for
--   3. a coached client reads the set_type of their coach's published program
--   4. deleting a prescription leaves the set, unlinked: it then counts as a working set
--
-- Run with a local stack up:  npm run db:test   (or offline: npm run db:test:offline exercise_progression)

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c9000000-0000-0000-0000-000000000001', 'xp-coach@test.local',    '{"full_name":"Coach","username":"xpcoach"}'),
  ('c9000000-0000-0000-0000-000000000011', 'xp-client@test.local',   '{"full_name":"Client","username":"xpclient"}'),
  ('c9000000-0000-0000-0000-000000000013', 'xp-stranger@test.local', '{"full_name":"Stranger","username":"xpstranger"}');
update public.users set role = 'coach' where id = 'c9000000-0000-0000-0000-000000000001';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000011', 'active', now());
insert into public.exercises (id, name_en) values ('c9000000-0000-0000-0000-0000000000e1', 'XP Bench');

insert into public.programs (id, coach_id, client_id, name, status) values
  ('c9000000-0000-0000-0000-0000000001a1', 'c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000011', 'XP plan', 'published');
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('c9000000-0000-0000-0000-0000000002a1', 'c9000000-0000-0000-0000-0000000001a1', 1, 0, 'Push');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps, set_type) values
  ('c9000000-0000-0000-0000-0000000003a1', 'c9000000-0000-0000-0000-0000000002a1', 'c9000000-0000-0000-0000-0000000000e1', 0, 2, '10', 'warmup'),
  ('c9000000-0000-0000-0000-0000000003a2', 'c9000000-0000-0000-0000-0000000002a1', 'c9000000-0000-0000-0000-0000000000e1', 1, 3, '8-10', 'normal');
insert into public.logged_sessions (id, user_id, program_day_id, client_generated_id, started_at, completed_at) values
  ('c9000000-0000-0000-0000-0000000004a1', 'c9000000-0000-0000-0000-000000000011', 'c9000000-0000-0000-0000-0000000002a1',
   gen_random_uuid(), now() - interval '1 day', now() - interval '1 day' + interval '1 hour');
insert into public.logged_sets (id, session_id, user_id, program_exercise_id, exercise_id, client_generated_id, set_index, reps, weight_kg) values
  ('c9000000-0000-0000-0000-0000000005a1', 'c9000000-0000-0000-0000-0000000004a1', 'c9000000-0000-0000-0000-000000000011',
   'c9000000-0000-0000-0000-0000000003a1', 'c9000000-0000-0000-0000-0000000000e1', gen_random_uuid(), 1, 10, 40),
  ('c9000000-0000-0000-0000-0000000005a2', 'c9000000-0000-0000-0000-0000000004a1', 'c9000000-0000-0000-0000-000000000011',
   'c9000000-0000-0000-0000-0000000003a2', 'c9000000-0000-0000-0000-0000000000e1', gen_random_uuid(), 2, 8, 80);

-- the read's shape: sets joined to their prescription, completed sessions only
create or replace function pg_temp.history(p_exercise uuid)
returns table (weight_kg numeric, set_type text) language sql as $fn$
  select s.weight_kg, pe.set_type
  from public.logged_sets s
  join public.logged_sessions ss on ss.id = s.session_id and ss.completed_at is not null
  left join public.program_exercises pe on pe.id = s.program_exercise_id
  where s.exercise_id = p_exercise
  order by s.set_index
$fn$;

-- 1. the owner
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000011');
select is((select count(*)::int from pg_temp.history('c9000000-0000-0000-0000-0000000000e1')), 2,
  '1a. the client reads both of their sets');
select is((select string_agg(coalesce(set_type, 'none'), ',') from pg_temp.history('c9000000-0000-0000-0000-0000000000e1')), 'warmup,normal',
  '1b. with the set_type of their coach''s published prescription (3) — warm-up told from working');

-- 2. a stranger
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000013');
select is((select count(*)::int from pg_temp.history('c9000000-0000-0000-0000-0000000000e1')), 0,
  '2a. a stranger reads none of the client''s sets for that exercise');
select is((select count(*)::int from public.logged_sets where user_id = 'c9000000-0000-0000-0000-000000000011'), 0,
  '2b. nor by asking for the client''s user id');
select is((select count(*)::int from public.program_exercises where id = 'c9000000-0000-0000-0000-0000000003a1'), 0,
  '2c. nor the prescription behind them');

-- the active coach reads the client's sets (sets_coach_read) — the analysis
-- itself always filters to the reader's own user id, so this is not shown to them
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.logged_sets where user_id = 'c9000000-0000-0000-0000-000000000011'), 2,
  '3a. the active coach may read the client''s sets, as before');

-- 4. a deleted prescription: the set stays, unlinked, and counts as working
select lives_ok($$ delete from public.program_exercises where id = 'c9000000-0000-0000-0000-0000000003a1' $$,
  '4a. the coach removes the warm-up row from the program');
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000011');
select is((select string_agg(coalesce(set_type, 'none'), ',') from pg_temp.history('c9000000-0000-0000-0000-0000000000e1')), 'none,normal',
  '4b. the client''s set survives with no prescription — the analysis then treats it as a working set');
reset role;

select * from finish();
rollback;
