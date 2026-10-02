-- pgTAP · timed sets and coach cues (20261025100000).
--
-- Pins down: measure is checked; a timed set stores its seconds and the
-- duration check holds; copy_program and duplicate_program_exercise keep
-- measure and the coach's notes; a coached client still cannot rewrite the
-- cue their coach wrote; the three library rows exist and are system rows.
--
-- Run with a local stack up:  npm run db:test   (or: npm run db:test:offline)

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a4000000-0000-0000-0000-000000000001', 'solo@timed.local',   '{"full_name":"Solo","username":"solo_timed"}'),
  ('a4000000-0000-0000-0000-000000000002', 'coach@timed.local',  '{"full_name":"Coach","username":"coach_timed"}'),
  ('a4000000-0000-0000-0000-000000000003', 'client@timed.local', '{"full_name":"Client","username":"client_timed"}');
update public.users set role = 'coach' where id = 'a4000000-0000-0000-0000-000000000002';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003', 'active', now());

insert into public.exercises (id, source, external_id, name_en, primary_muscles, equipment) values
  ('b4000000-0000-0000-0000-000000000001', 'custom', 'tm-plank', 'Plank', '{abdominals}', 'body only');

insert into public.programs (id, coach_id, client_id, name, status, intensity_mode) values
  ('c4000000-0000-0000-0000-000000000001', null, 'a4000000-0000-0000-0000-000000000001', 'Core', 'published', 'rir'),
  ('c4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003', 'Coached core', 'published', 'rir');
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('d4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 1, 1, 'Core A'),
  ('d4000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000002', 1, 1, 'Core B');
insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps, measure, notes) values
  ('e4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 0, 3, '30-45', 'time', 'Squeeze the glutes'),
  ('e4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000002', 'b4000000-0000-0000-0000-000000000001', 0, 3, '30', 'time', 'Ribs down');

-- ---------- columns ----------
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ update public.program_exercises set measure = 'distance' where id = 'e4000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'an unknown measure is refused');

select is(
  (select measure from public.program_exercises where id = 'e4000000-0000-0000-0000-000000000001'),
  'time', 'a timed prescription keeps its measure');

insert into public.logged_sessions (id, user_id, program_day_id, client_generated_id, started_at) values
  ('f4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
   'f4000000-0000-0000-0000-0000000000a1', now());

select lives_ok(
  $$ insert into public.logged_sets (session_id, user_id, program_exercise_id, exercise_id, client_generated_id, set_index, reps, weight_kg, duration_seconds)
     values ('f4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
             'b4000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-0000000000b1', 1, 0, 0, 45) $$,
  'a timed set is logged with zero reps and its seconds');

select throws_ok(
  $$ insert into public.logged_sets (session_id, user_id, program_exercise_id, exercise_id, client_generated_id, set_index, reps, weight_kg, duration_seconds)
     values ('f4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
             'b4000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-0000000000b2', 2, 0, 0, 0) $$,
  '23514', null, 'a zero-second set is refused');

-- ---------- copies keep measure and the cue ----------
select lives_ok(
  $$ select public.duplicate_program_exercise('e4000000-0000-0000-0000-000000000001') $$,
  'the owner duplicates a timed exercise');

select is(
  (select string_agg(measure || ':' || coalesce(notes, ''), ',' order by position)
     from public.program_exercises where program_day_id = 'd4000000-0000-0000-0000-000000000001'),
  'time:Squeeze the glutes,time:Squeeze the glutes', 'the duplicate keeps measure and the cue');

-- Its own statement: a read in the same one would not see the copy's rows.
select set_config('test.copy', public.copy_program('c4000000-0000-0000-0000-000000000001', 'Core copy')::text, true);
select is(
  (select e.measure || ':' || e.notes
     from public.program_exercises e
     join public.program_days d on d.id = e.program_day_id
    where d.program_id = current_setting('test.copy')::uuid
    limit 1),
  'time:Squeeze the glutes', 'a copied program keeps measure and the cue');

-- ---------- the cue is the coach's ----------
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000003');

select is(
  (select notes from public.program_exercises where id = 'e4000000-0000-0000-0000-000000000002'),
  'Ribs down', 'the client reads the cue their coach wrote');

update public.program_exercises set notes = 'whatever' where id = 'e4000000-0000-0000-0000-000000000002';
select pg_temp.authenticate_as('a4000000-0000-0000-0000-000000000002');
select is(
  (select notes from public.program_exercises where id = 'e4000000-0000-0000-0000-000000000002'),
  'Ribs down', 'a coached client cannot rewrite the coach''s cue');

-- ---------- library additions ----------
reset role;
select is(
  (select count(*)::int from public.exercises
    where owner_id is null and external_id in ('voinic:glute_bridge', 'voinic:reverse_lunge', 'voinic:assisted_reverse_lunge')),
  3, 'the three new library exercises are system rows');

select is(
  (select equipment from public.exercises where external_id = 'voinic:glute_bridge'),
  'body only', 'the glute bridge is bodyweight');

select * from finish();
rollback;
