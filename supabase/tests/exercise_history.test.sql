-- pgTAP · exercise history is private.
--
-- /exercises/[id] and the set logger's "previous workout" both read
-- public.logged_sets filtered only by exercise_id — the user filter is the
-- policy, not the query. If `sets_owner` ever stops scoping to auth.uid(),
-- typing someone else's exercise id into the address bar would show their
-- numbers, and no application test would catch it. This is that test.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
  ('aaaaaaaa-0000-0000-0000-000000000001', 'coach.a@test.local',  '{"full_name":"Coach A"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'lifter.a@test.local', '{"full_name":"Lifter A"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'lifter.b@test.local', '{"full_name":"Lifter B"}');

update public.users set role = 'coach'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'active', now());

-- One library exercise both lifters train.
insert into public.exercises (id, source, external_id, name_en, primary_muscles)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'custom', 'bench-test', 'Bench Press', '{chest}');

-- A completed session each, plus an abandoned one for Lifter A. The abandoned
-- session is what the application filters out; it is here so the row counts
-- below prove the policy sees the whole table, not a pre-filtered slice.
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '3 days'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000002', now(), null),
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003',
   'dddddddd-0000-0000-0000-000000000003', now() - interval '1 day', now() - interval '1 day');

insert into public.logged_sets
  (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg)
values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 1, 8, 110.00),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002', 1, 5, 60.00),
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000003', 1, 10, 80.00);

-- ---------- a lifter reads their own history ----------
select pg_temp.authenticate_as('aaaaaaaa-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.logged_sets
   where exercise_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  2,
  'a lifter reads their own sets for an exercise'
);

-- ---------- and nobody else's, however the query is written ----------
select is(
  (select count(*)::int from public.logged_sets
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0,
  'one lifter cannot read another lifter''s sets by asking for them directly'
);
select is(
  (select count(*)::int from public.logged_sessions
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  0,
  'nor the sessions those sets hang from'
);

-- ---------- the active coach may ----------
select pg_temp.authenticate_as('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.logged_sets),
  2,
  'an active coach reads their own client''s sets — and only theirs'
);

-- ---------- the other lifter may not, even as a coach's exercise ----------
select pg_temp.authenticate_as('aaaaaaaa-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.logged_sets),
  1,
  'the unrelated lifter sees exactly their own one set'
);

-- ---------- ending the relationship removes access ----------
reset role;
update public.trainer_clients set status = 'ended', ended_at = now()
where coach_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select pg_temp.authenticate_as('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.logged_sets),
  0,
  'an ended coach loses access to the client''s exercise history'
);

select * from finish();
rollback;
