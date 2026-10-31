-- pgTAP · a workout nobody finished still counts (20261211110000).
--
-- close_stale_sessions() closes an open session with sets once its day has
-- ended on the person's calendar and its last set is 4+ hours old, at that
-- set's time — so workout_days() (the streak) and everything else filtering on
-- completed_at sees it. Today's session, an empty session and a finished one
-- are left alone, and nobody signed in can call it.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs open_sessions_count

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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
  ('a1000000-0000-0000-0000-0000000000a1', 'forgetful@open.local', '{"full_name":"Forgetful","username":"forgetful"}');
update public.users set timezone = 'Europe/Bucharest' where id = 'a1000000-0000-0000-0000-0000000000a1';

insert into public.exercises (id, source, external_id, name_en, primary_muscles)
values ('b1000000-0000-0000-0000-000000000001', 'custom', 'open-sessions-test', 'Squat', '{quads}');

-- local noon N days ago in Bucharest
create or replace function pg_temp.noon(p_days int) returns timestamptz language sql as $fn$
  select (((now() at time zone 'Europe/Bucharest')::date - p_days) || ' 12:00')::timestamp at time zone 'Europe/Bucharest';
$fn$;

insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  -- 1: three days ago, three sets, never finished
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1', gen_random_uuid(), pg_temp.noon(3), null),
  -- 2: two days ago, no sets at all
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-0000000000a1', gen_random_uuid(), pg_temp.noon(2), null),
  -- 3: five days ago, finished properly
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-0000000000a1', gen_random_uuid(), pg_temp.noon(5), pg_temp.noon(5) + interval '50 minutes'),
  -- 4: today, still being logged
  ('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-0000000000a1', gen_random_uuid(), now() - interval '1 minute', null);

insert into public.logged_sets
  (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg, client_ts, received_at)
values
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000001',
   gen_random_uuid(), 1, 5, 100, pg_temp.noon(3) + interval '5 minutes',  pg_temp.noon(3) + interval '5 minutes'),
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000001',
   gen_random_uuid(), 2, 5, 100, pg_temp.noon(3) + interval '15 minutes', pg_temp.noon(3) + interval '15 minutes'),
  -- replayed from the outbox a day later: client_ts is when it was lifted
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000001',
   gen_random_uuid(), 3, 5, 100, pg_temp.noon(3) + interval '40 minutes', pg_temp.noon(2)),
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000001',
   gen_random_uuid(), 1, 5, 90, pg_temp.noon(5) + interval '10 minutes', pg_temp.noon(5) + interval '10 minutes'),
  ('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-000000000001',
   gen_random_uuid(), 1, 5, 95, now() - interval '1 minute', now() - interval '1 minute');

-- ---------- before ----------
select pg_temp.authenticate_as('a1000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.workout_days(null)), 1,
  'before: only the finished session is a workout day');
reset role;

-- ---------- nobody signed in may run it ----------
select ok(not has_function_privilege('authenticated', 'public.close_stale_sessions(interval)', 'execute'),
  'authenticated cannot execute close_stale_sessions()');
select ok(not has_function_privilege('anon', 'public.close_stale_sessions(interval)', 'execute'),
  'anon cannot execute close_stale_sessions()');

-- ---------- the pass ----------
select is(public.close_stale_sessions(), 1, 'exactly one session is closed');

select is((select completed_at from public.logged_sessions where id = 'c1000000-0000-0000-0000-000000000001'),
  pg_temp.noon(3) + interval '40 minutes',
  'closed at its last set''s client time, not at the late replay''s arrival');
select ok((select completed_at is null from public.logged_sessions where id = 'c1000000-0000-0000-0000-000000000002'),
  'an empty session stays open');
select is((select completed_at from public.logged_sessions where id = 'c1000000-0000-0000-0000-000000000003'),
  pg_temp.noon(5) + interval '50 minutes', 'a finished session keeps its own completed_at');
select ok((select completed_at is null from public.logged_sessions where id = 'c1000000-0000-0000-0000-000000000004'),
  'today''s session is never closed by the engine');

select is(public.close_stale_sessions(), 0, 'a second pass finds nothing left to close');
select is(public.close_stale_sessions(interval '0 seconds'), 0,
  'with no idle window at all, today''s session still stays open: its day has not ended');

-- ---------- after: the streak sees it ----------
select pg_temp.authenticate_as('a1000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.workout_days(null)), 2,
  'after: the unfinished workout is a workout day');
select is((select day from public.workout_days(null) order by day desc limit 1),
  to_char((now() at time zone 'Europe/Bucharest')::date - 3, 'YYYY-MM-DD'),
  'on the day it was trained');
reset role;

select * from finish();
rollback;
