-- pgTAP · custom exercises are private to their owner, except where something
-- the reader can already see points at them (20261113100000).
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures ----------
-- coach A (1) coaches client M (2); coach B (3) is a stranger; S (4) trains solo.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'coacha@cx.local', '{"full_name":"Coach A"}'),
  ('22222222-2222-2222-2222-222222222222', 'maria@cx.local',  '{"full_name":"Maria"}'),
  ('33333333-3333-3333-3333-333333333333', 'coachb@cx.local', '{"full_name":"Coach B"}'),
  ('44444444-4444-4444-4444-444444444444', 'solo@cx.local',   '{"full_name":"Solo"}');
update public.users set role = 'coach'
 where id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'active', now());

insert into public.exercises (id, owner_id, source, name_en) values
  ('e0000000-0000-0000-0000-000000000001', null, 'free-exercise-db', 'Back squat'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'custom', 'A: in M''s program'),
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'custom', 'A: unused'),
  ('e0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'custom', 'M: logged'),
  ('e0000000-0000-0000-0000-000000000005', '44444444-4444-4444-4444-444444444444', 'custom', 'S: logged');

insert into public.programs (id, coach_id, client_id, name, status) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'Block 1', 'published');
insert into public.program_days (id, program_id, day_index, name) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1, 'Day 1');
insert into public.program_exercises (program_day_id, exercise_id, target_sets, target_reps) values
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 3, '8');

insert into public.logged_sessions (id, user_id, client_generated_id, started_at) values
  ('50000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', gen_random_uuid(), now()),
  ('50000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', gen_random_uuid(), now());
insert into public.logged_sets (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg) values
  ('50000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'e0000000-0000-0000-0000-000000000004', gen_random_uuid(), 0, 8, 40),
  ('50000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444',
   'e0000000-0000-0000-0000-000000000005', gen_random_uuid(), 0, 8, 40);

create temp table ids as select id from public.exercises where id::text like 'e0000000-%';
grant select on ids to authenticated;

-- ---------- the stranger coach ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
select is(
  (select array_agg(e.name_en order by e.name_en) from public.exercises e join ids using (id)),
  array['Back squat'],
  'a stranger sees the library and none of anyone''s custom exercises');

-- ---------- the owning coach ----------
select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select ok(exists (select 1 from public.exercises where id = 'e0000000-0000-0000-0000-000000000003'),
  'the owner sees an exercise nothing uses');
select ok(exists (select 1 from public.exercises where id = 'e0000000-0000-0000-0000-000000000004'),
  'the active coach sees the custom exercise in a client''s log');
select ok(not exists (select 1 from public.exercises where id = 'e0000000-0000-0000-0000-000000000005'),
  'a coach does not see a non-client''s custom exercise, logged or not');

-- ---------- the client ----------
select pg_temp.authenticate_as('22222222-2222-2222-2222-222222222222');
select ok(exists (select 1 from public.exercises where id = 'e0000000-0000-0000-0000-000000000002'),
  'a client sees the coach''s custom exercise in their published program');
select ok(not exists (select 1 from public.exercises where id = 'e0000000-0000-0000-0000-000000000003'),
  'a client does not see the coach''s other custom exercises');
select ok(exists (select 1 from public.exercises where id = 'e0000000-0000-0000-0000-000000000004'),
  'a client sees their own custom exercise');

-- ---------- after the relationship ends ----------
select pg_temp.authenticate_as('11111111-1111-1111-1111-111111111111');
select public.coaching_transition(
  (select id from public.trainer_clients where client_id = '22222222-2222-2222-2222-222222222222'), 'ended');
select ok(not exists (select 1 from public.exercises where id = 'e0000000-0000-0000-0000-000000000004'),
  'an ended coach no longer sees the former client''s custom exercise');

-- ---------- writes are unchanged ----------
select pg_temp.authenticate_as('33333333-3333-3333-3333-333333333333');
update public.exercises set name_en = 'hijacked' where id = 'e0000000-0000-0000-0000-000000000003';
reset role;
select is((select name_en from public.exercises where id = 'e0000000-0000-0000-0000-000000000003'),
  'A: unused', 'a stranger still cannot rename someone else''s exercise');

select * from finish();
rollback;
