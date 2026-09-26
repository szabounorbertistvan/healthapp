-- pgTAP · exercise_best_sets(): the set behind each lift's best estimated 1RM.
--
-- The Progress page's personal-records list reads this instead of trusting the
-- stored is_pr flags, so its number is the exercise page's number:
-- relevantOneRm() from packages/shared/exercise-analytics — completed sessions
-- only, a loaded set, 1..12 reps, one rep taken at face value. The SQL only
-- CHOOSES the set (ranking on relevantOneRm × 30, exact numeric); the app
-- computes the value. These tests pin the choice and the privacy.
--
-- Run with a local stack up:  npm run db:test   (or: npm run db:test:offline)

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
  ('a1000000-0000-0000-0000-000000000001', 'lifter@best.local', '{"full_name":"Lifter"}'),
  ('a1000000-0000-0000-0000-000000000002', 'other@best.local',  '{"full_name":"Other"}'),
  ('a1000000-0000-0000-0000-000000000003', 'coach@best.local',  '{"full_name":"Coach"}');

update public.users set role = 'coach' where id = 'a1000000-0000-0000-0000-000000000003';
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'active', now());

insert into public.exercises (id, source, external_id, name_en, name_ro, primary_muscles) values
  ('b1000000-0000-0000-0000-000000000001', 'custom', 'best-bench',  'Bench',  'Împins', '{chest}'),
  ('b1000000-0000-0000-0000-000000000002', 'custom', 'best-curl',   'Curl',   null,     '{biceps}'),
  ('b1000000-0000-0000-0000-000000000003', 'custom', 'best-pullup', 'Pullup', null,     '{lats}'),
  ('b1000000-0000-0000-0000-000000000004', 'custom', 'best-press',  'Press',  null,     '{shoulders}');

-- Lifter: two completed sessions and one abandoned; Other: one completed.
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001', now() - interval '10 days', now() - interval '10 days'),
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000002', now() - interval '3 days', now() - interval '3 days'),
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000003', now(), null),
  ('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002',
   'd1000000-0000-0000-0000-000000000004', now() - interval '1 day', now() - interval '1 day');

insert into public.logged_sets
  (session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg, is_pr)
values
  -- Bench: 100×5 (ranks 3500) in the older session, 105×3 (3465) later, the
  -- same 100×5 again later (a tie: the earlier session wins), and 200×5 in
  -- the abandoned session (never counts). The PR flag sits on a lighter set
  -- on purpose — the function must not care.
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 1, 5, 100.00, false),
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 2, 4, 72.50, true),
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 1, 3, 105.00, false),
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 2, 5, 100.00, false),
  ('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005', 1, 5, 200.00, true),
  -- Curl: 20×20 is past the 12-rep line (no estimate), 15×12 ranks 630,
  -- 18×1 ranks 540.
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000006', 1, 20, 20.00, true),
  ('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000007', 2, 12, 15.00, false),
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000008', 1, 1, 18.00, false),
  -- Pullup: bodyweight only — no estimate, so no row.
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000009', 1, 10, 0.00, false),
  -- Press: one rep is taken at face value (100), so 96×2 (102.4) wins. Epley
  -- applied to the single would have claimed 103.3 and picked the wrong set.
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000010', 1, 1, 100.00, true),
  ('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001',
   'b1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000011', 2, 2, 96.00, false),
  -- Other's bench, far heavier than anything Lifter did.
  ('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000012', 1, 1, 300.00, true);

-- ---------- the lifter ----------
select pg_temp.authenticate_as('a1000000-0000-0000-0000-000000000001');

select is((select count(*)::int from public.exercise_best_sets()), 3,
  'one row per lift with an estimate: bench, curl, press — never the bodyweight pullup');

select is(
  (select weight_kg::text || ' x ' || reps from public.exercise_best_sets()
   where exercise_id = 'b1000000-0000-0000-0000-000000000001'),
  '100.00 x 5',
  'bench: 100×5 beats 105×3; the abandoned 200×5 and the is_pr flag play no part');

select is(
  (select completed_at from public.exercise_best_sets() where exercise_id = 'b1000000-0000-0000-0000-000000000001'),
  (select completed_at from public.logged_sessions where id = 'c1000000-0000-0000-0000-000000000001'),
  'a tie goes to the session that first reached it');

select is(
  (select weight_kg::text || ' x ' || reps from public.exercise_best_sets()
   where exercise_id = 'b1000000-0000-0000-0000-000000000002'),
  '15.00 x 12',
  'curl: sets past 12 reps have no estimate; 15×12 beats 18×1');

select is(
  (select weight_kg::text || ' x ' || reps from public.exercise_best_sets()
   where exercise_id = 'b1000000-0000-0000-0000-000000000004'),
  '96.00 x 2',
  'press: a single counts at face value, so 96×2 beats 100×1');

select is(
  (select name_en || ' / ' || name_ro from public.exercise_best_sets()
   where exercise_id = 'b1000000-0000-0000-0000-000000000001'),
  'Bench / Împins',
  'the names travel with the row');

-- ---------- someone else ----------
select pg_temp.authenticate_as('a1000000-0000-0000-0000-000000000002');

select is(
  (select string_agg(exercise_id::text || ' ' || weight_kg::text, ',') from public.exercise_best_sets()),
  'b1000000-0000-0000-0000-000000000001 300.00',
  'another user sees only their own lifts');

-- ---------- the coach ----------
-- The function answers for auth.uid() only and takes no user argument, so a
-- coach — who may read the client's sets through sets_coach_read — still gets
-- only their own (none), never the client's.
select pg_temp.authenticate_as('a1000000-0000-0000-0000-000000000003');

select is((select count(*)::int from public.exercise_best_sets()), 0,
  'a coach gets their own bests, not their client''s');

select is(
  (select count(*)::int from public.logged_sets where user_id = 'a1000000-0000-0000-0000-000000000001'),
  11,
  'control: the coach CAN read the client''s sets directly, so the 0 above is the function scoping, not RLS');

-- ---------- privileges ----------
reset role;

select is(
  (select prosecdef from pg_proc where oid = 'public.exercise_best_sets()'::regprocedure),
  false,
  'security invoker: RLS on logged_sets still applies inside');

select ok(
  not has_function_privilege('anon', 'public.exercise_best_sets()', 'execute'),
  'anon cannot execute');

select ok(
  has_function_privilege('authenticated', 'public.exercise_best_sets()', 'execute'),
  'authenticated can execute');

select * from finish();
rollback;
