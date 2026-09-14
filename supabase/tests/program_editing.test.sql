-- pgTAP · program editing, who may edit, circuits, day order, logged-set
-- edits, habit removal, exercise renames and following — the policies and
-- functions from 20260914130000_program_editing_and_following.sql.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

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
  ('c0000000-0000-0000-0000-0000000000c3', 'coach@pe.local',   '{"full_name":"Coach","username":"coach"}'),
  ('a0000000-0000-0000-0000-0000000000a3', 'coached@pe.local', '{"full_name":"Coached","username":"coached"}'),
  ('b0000000-0000-0000-0000-0000000000b3', 'solo@pe.local',    '{"full_name":"Solo","username":"solo"}'),
  ('d0000000-0000-0000-0000-0000000000b3', 'other@pe.local',   '{"full_name":"Other","username":"other"}');
update public.users set role = 'coach' where id = 'c0000000-0000-0000-0000-0000000000c3';

insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('c0000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000a3', 'active', now());
-- an invite the solo client will claim later
insert into public.trainer_clients (coach_id, status, invite_code, invite_expires_at) values
  ('c0000000-0000-0000-0000-0000000000c3', 'invited', 'JOINME01', now() + interval '30 days');

insert into public.exercises (id, name_en, name_ro, source) values
  ('e0000000-0000-0000-0000-0000000000e3', 'Bench Press', 'Împins la piept', 'free-exercise-db'),
  ('e0000000-0000-0000-0000-0000000000e4', 'Lat Pulldown', 'Tracțiuni la helcometru', 'free-exercise-db');
insert into public.exercises (id, name_en, name_ro, source, owner_id) values
  ('e0000000-0000-0000-0000-0000000000e5', 'Cable fly low', 'Fluturări la cablu jos', 'custom', 'b0000000-0000-0000-0000-0000000000b3');

-- the coach's program for the coached client, and the solo client's own
insert into public.programs (id, coach_id, client_id, name, status) values
  ('90000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000a3', 'Coach plan', 'published');
insert into public.programs (id, coach_id, client_id, name, status) values
  ('90000000-0000-0000-0000-0000000000a2', null, 'b0000000-0000-0000-0000-0000000000b3', 'My plan', 'published');
-- an older program the coached client built alone before the coach arrived
insert into public.programs (id, coach_id, client_id, name, status) values
  ('90000000-0000-0000-0000-0000000000a3', null, 'a0000000-0000-0000-0000-0000000000a3', 'Old solo plan', 'published');
insert into public.program_days (id, program_id, week_index, day_index, name) values
  ('91000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-0000000000a1', 1, 0, 'Chest'),
  ('91000000-0000-0000-0000-0000000000b2', '90000000-0000-0000-0000-0000000000a1', 1, 1, 'Back'),
  ('91000000-0000-0000-0000-0000000000b3', '90000000-0000-0000-0000-0000000000a1', 1, 2, 'Legs'),
  ('91000000-0000-0000-0000-0000000000b4', '90000000-0000-0000-0000-0000000000a2', 1, 0, 'Solo day'),
  ('91000000-0000-0000-0000-0000000000b5', '90000000-0000-0000-0000-0000000000a3', 1, 0, 'Old day');
-- a session the coached client logged against Legs (as postgres — sets_owner would refuse the coach)
insert into public.logged_sessions (user_id, program_day_id, client_generated_id, started_at, completed_at) values
  ('a0000000-0000-0000-0000-0000000000a3', '91000000-0000-0000-0000-0000000000b3', gen_random_uuid(), now() - interval '2 days', now() - interval '2 days' + interval '1 hour');

-- ============================================================
-- 1. the coach edits their program: targets, circuits, order
-- ============================================================
select pg_temp.authenticate_as('c0000000-0000-0000-0000-0000000000c3');
select lives_ok($$
  insert into public.program_days (program_id, week_index, day_index, name)
  values ('90000000-0000-0000-0000-0000000000a1', 1, 3, 'Arms')
$$, 'the coach creates a training day');
select lives_ok($$
  insert into public.program_exercises (id, program_day_id, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds, circuit)
  values ('92000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000e3', 0, 4, '8', 2, 90, 1),
         ('92000000-0000-0000-0000-0000000000c2', '91000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000e4', 1, 3, '12', 1, 60, 1)
$$, 'the coach prescribes 4 × 8 RIR 2 and 3 × 12 RIR 1, linked as circuit A');
select is((select target_sets || ' x ' || target_reps || ' rir ' || target_rpe || ' circuit ' || circuit from public.program_exercises where id = '92000000-0000-0000-0000-0000000000c1'),
  '4 x 8 rir 2.0 circuit 1', 'sets / reps / RIR / circuit are persisted');
select lives_ok($$ update public.program_exercises set target_sets = 5, target_rpe = 1, circuit = null where id = '92000000-0000-0000-0000-0000000000c1' $$,
  'the coach edits a prescribed exercise and unlinks it');
select is((select circuit from public.program_exercises where id = '92000000-0000-0000-0000-0000000000c1'), null, 'unlinked: circuit is null');
select throws_ok($$ update public.program_exercises set circuit = 27 where id = '92000000-0000-0000-0000-0000000000c2' $$, '23514', null, 'a circuit number outside A..Z is refused');
select lives_ok($$ update public.program_days set name = 'Chest & triceps' where id = '91000000-0000-0000-0000-0000000000b1' $$, 'the coach renames a day');

-- Day 3 → Day 1 in two moves; history stays attached to the day's id
select is(public.move_program_day('91000000-0000-0000-0000-0000000000b3', -1), true, 'Legs moves up one');
select is(public.move_program_day('91000000-0000-0000-0000-0000000000b3', -1), true, 'and up again to the top');
select is((select array_agg(name order by day_index) from public.program_days where program_id = '90000000-0000-0000-0000-0000000000a1'),
  array['Legs', 'Chest & triceps', 'Back', 'Arms'], 'Day 1 — Legs, Day 2 — Chest, Day 3 — Back');
select is(public.move_program_day('91000000-0000-0000-0000-0000000000b3', -1), false, 'the top day cannot move higher');
select is((select count(*)::int from public.logged_sessions where program_day_id = '91000000-0000-0000-0000-0000000000b3'), 1,
  'the session logged against Legs still points at Legs after the reorder');

-- ============================================================
-- 2. who may edit: coached client no, solo client yes, then flips
-- ============================================================
select pg_temp.authenticate_as('a0000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.programs), 2, 'the coached client still reads the coach plan and their old solo plan');
select throws_ok($$
  insert into public.programs (coach_id, client_id, name) values (null, 'a0000000-0000-0000-0000-0000000000a3', 'sneaky')
$$, '42501', null, 'a coached client cannot create a program');
update public.program_days set name = 'hacked' where id = '91000000-0000-0000-0000-0000000000b1';
select is((select name from public.program_days where id = '91000000-0000-0000-0000-0000000000b1'), 'Chest & triceps', 'a coached client cannot rename the coach''s day');
update public.program_exercises set target_sets = 1 where id = '92000000-0000-0000-0000-0000000000c1';
select is((select target_sets from public.program_exercises where id = '92000000-0000-0000-0000-0000000000c1'), 5, 'a coached client cannot change the coach''s prescription');
update public.program_days set name = 'hacked' where id = '91000000-0000-0000-0000-0000000000b5';
select is((select name from public.program_days where id = '91000000-0000-0000-0000-0000000000b5'), 'Old day', 'a coached client cannot edit their own old solo program either');
select throws_ok($$
  insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps)
  values ('91000000-0000-0000-0000-0000000000b5', 'e0000000-0000-0000-0000-0000000000e3', 0, 3, '10')
$$, '42501', null, 'nor add exercises to it');
select throws_ok($$ select public.move_program_day('91000000-0000-0000-0000-0000000000b1', 1) $$, '42501', null, 'nor reorder the coach''s days');

select pg_temp.authenticate_as('b0000000-0000-0000-0000-0000000000b3');
select lives_ok($$
  insert into public.programs (coach_id, client_id, name) values (null, 'b0000000-0000-0000-0000-0000000000b3', 'Second plan')
$$, 'a solo client creates a program');
select lives_ok($$
  insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps, target_rpe)
  values ('91000000-0000-0000-0000-0000000000b4', 'e0000000-0000-0000-0000-0000000000e5', 0, 3, '10', 2)
$$, 'a solo client prescribes an exercise in their own day');
select lives_ok($$ update public.program_days set name = 'Push' where id = '91000000-0000-0000-0000-0000000000b4' $$, 'a solo client renames their own day');
select throws_ok($$
  insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps)
  values ('91000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000e3', 9, 3, '10')
$$, '42501', null, 'a solo client cannot touch someone else''s program');

-- the solo client connects to the coach with the invitation code…
select lives_ok($$ select public.accept_invite('JOINME01') $$, 'a valid invitation code connects the client to the coach');
select throws_ok($$ select public.accept_invite('JOINME01') $$, 'P0001', 'ALREADY_HAS_COACH', 'a second code is refused once coached');
select pg_temp.authenticate_as('d0000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.accept_invite('NOPE0000') $$, 'P0001', 'INVALID_CODE', 'an unknown code is refused');
select pg_temp.authenticate_as('b0000000-0000-0000-0000-0000000000b3');
select is(public.has_active_coach(), true, 'the relationship is active');
-- …and from then on the program is the coach's to edit
update public.program_days set name = 'after coach' where id = '91000000-0000-0000-0000-0000000000b4';
select is((select name from public.program_days where id = '91000000-0000-0000-0000-0000000000b4'), 'Push', 'after connecting, the client can no longer edit their own program');
select is((select count(*)::int from public.programs where id = '90000000-0000-0000-0000-0000000000a2'), 1, 'but still sees it');

-- ============================================================
-- 3. logged sets: edit your own, never another's
-- ============================================================
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('93000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000b3', gen_random_uuid(), now() - interval '1 hour', now());
insert into public.logged_sets (id, session_id, user_id, exercise_id, set_index, weight_kg, reps, client_generated_id) values
  ('94000000-0000-0000-0000-0000000000e1', '93000000-0000-0000-0000-0000000000d1', 'b0000000-0000-0000-0000-0000000000b3', 'e0000000-0000-0000-0000-0000000000e3', 1, 80, 8, gen_random_uuid());
select lives_ok($$ update public.logged_sets set weight_kg = 82.5, reps = 8, rir = 1 where id = '94000000-0000-0000-0000-0000000000e1' $$, 'the owner corrects a set');
select is((select weight_kg from public.logged_sets where id = '94000000-0000-0000-0000-0000000000e1'), 82.5::numeric, '82.5 is stored as 82.5');
select pg_temp.authenticate_as('d0000000-0000-0000-0000-0000000000b3');
update public.logged_sets set weight_kg = 1 where id = '94000000-0000-0000-0000-0000000000e1';
select pg_temp.authenticate_as('b0000000-0000-0000-0000-0000000000b3');
select is((select weight_kg from public.logged_sets where id = '94000000-0000-0000-0000-0000000000e1'), 82.5::numeric, 'another user''s update changed nothing');

-- ============================================================
-- 4. habits: archive your own, not another's
-- ============================================================
insert into public.habits (id, user_id, created_by, name) values
  ('95000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-0000000000b3', 'Walk');
select lives_ok($$ update public.habits set active = false where id = '95000000-0000-0000-0000-0000000000f1' $$, 'the owner archives a habit');
select is((select active from public.habits where id = '95000000-0000-0000-0000-0000000000f1'), false, 'it is inactive, its rows intact');
select pg_temp.authenticate_as('d0000000-0000-0000-0000-0000000000b3');
update public.habits set active = true where id = '95000000-0000-0000-0000-0000000000f1';
delete from public.habits where id = '95000000-0000-0000-0000-0000000000f1';
select pg_temp.authenticate_as('b0000000-0000-0000-0000-0000000000b3');
select is((select active from public.habits where id = '95000000-0000-0000-0000-0000000000f1'), false, 'another user can neither revive nor delete it');

-- ============================================================
-- 5. exercise names: custom by owner only, system never
-- ============================================================
select lives_ok($$ update public.exercises set name_en = 'Low cable fly', name_ro = 'Fluturări cablu jos' where id = 'e0000000-0000-0000-0000-0000000000e5' $$,
  'the owner renames their custom exercise');
update public.exercises set name_en = 'Chest Press' where id = 'e0000000-0000-0000-0000-0000000000e3';
select is((select name_en from public.exercises where id = 'e0000000-0000-0000-0000-0000000000e3'), 'Bench Press', 'a system exercise cannot be renamed by a client');
select pg_temp.authenticate_as('d0000000-0000-0000-0000-0000000000b3');
update public.exercises set name_en = 'Mine now' where id = 'e0000000-0000-0000-0000-0000000000e5';
select is((select name_en from public.exercises where id = 'e0000000-0000-0000-0000-0000000000e5'), 'Low cable fly', 'someone else''s custom exercise cannot be renamed');

-- ============================================================
-- 6. following: lists, one notification, no forgery
-- ============================================================
select pg_temp.authenticate_as('d0000000-0000-0000-0000-0000000000b3');
select lives_ok($$ insert into public.social_follows (follower_id, following_id) values ('d0000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-0000000000b3') $$, 'Other follows Solo');
delete from public.social_follows where follower_id = 'd0000000-0000-0000-0000-0000000000b3' and following_id = 'b0000000-0000-0000-0000-0000000000b3';
insert into public.social_follows (follower_id, following_id) values ('d0000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-0000000000b3');
select pg_temp.authenticate_as('b0000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from public.notifications where user_id = 'b0000000-0000-0000-0000-0000000000b3' and category = 'new_follower'), 1,
  'follow / unfollow / follow notifies once');
select is((select array_agg(username) from public.social_follow_list('b0000000-0000-0000-0000-0000000000b3', 'followers')), array['other'], 'the followers list names the follower');
select is((select count(*)::int from public.social_follow_list('d0000000-0000-0000-0000-0000000000b3', 'following')), 1, 'the following list works for anyone visible');
select throws_ok($$ select * from public.social_follow_list('b0000000-0000-0000-0000-0000000000b3', 'friends') $$, '22023', null, 'an unknown list is refused');
delete from public.social_follows where follower_id = 'd0000000-0000-0000-0000-0000000000b3';
select is((select count(*)::int from public.social_follows where follower_id = 'd0000000-0000-0000-0000-0000000000b3'), 1, 'a user cannot delete someone else''s follow');

select * from finish();
rollback;
