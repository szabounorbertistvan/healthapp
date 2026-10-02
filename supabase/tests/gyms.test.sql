-- pgTAP · gyms (20261023100000, 20261024100000): who can read and write
-- gyms, the home gym and its opt-in board, coaches located at a gym through
-- their Coach Discovery profile, and the coaching request → relationship path
-- with the one-active-coach rule.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

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
  ('a1000000-0000-0000-0000-0000000000a1', 'admin@gym.local',  '{"full_name":"Admin","username":"gymadmin"}'),
  ('c1000000-0000-0000-0000-0000000000c1', 'coach@gym.local',  '{"full_name":"Coach C.","username":"coachc"}'),
  ('c2000000-0000-0000-0000-0000000000c2', 'coach2@gym.local', '{"full_name":"Coach D.","username":"coachd"}'),
  ('d1000000-0000-0000-0000-0000000000d1', 'ana@gym.local',    '{"full_name":"Ana","username":"ana"}'),
  ('d2000000-0000-0000-0000-0000000000d2', 'ion@gym.local',    '{"full_name":"Ion","username":"ion"}'),
  ('d3000000-0000-0000-0000-0000000000d3', 'eva@gym.local',    '{"full_name":"Eva","username":"eva"}');
update public.users set role = 'admin' where id = 'a1000000-0000-0000-0000-0000000000a1';
update public.users set role = 'coach' where id in ('c1000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-0000000000c2');
update public.users set role = 'client', city = 'Cluj-Napoca', leaderboard_visibility = 'public'
  where id in ('d1000000-0000-0000-0000-0000000000d1', 'd2000000-0000-0000-0000-0000000000d2', 'd3000000-0000-0000-0000-0000000000d3');
insert into public.exercises (id, name_en, name_ro, source) values
  ('e1000000-0000-0000-0000-0000000000ee', 'Squat', 'Genuflexiuni', 'custom');

-- One completed session today, 5 sets of 100 × 10.
create or replace function pg_temp.session(p_user uuid)
returns void language plpgsql as $fn$
declare v_id uuid; i int;
begin
  insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at)
  values (p_user, gen_random_uuid(), now() - interval '1 hour', now()) returning id into v_id;
  for i in 1..5 loop
    insert into public.logged_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, rpe, client_generated_id)
    values (v_id, p_user, 'e1000000-0000-0000-0000-0000000000ee', i, 100, 10, 8, gen_random_uuid());
  end loop;
end;
$fn$;
select pg_temp.session('d1000000-0000-0000-0000-0000000000d1');
select pg_temp.session('d2000000-0000-0000-0000-0000000000d2');
select pg_temp.session('d3000000-0000-0000-0000-0000000000d3');

-- ---------- 1. gyms: admin writes, everyone reads active ----------
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000d1');
select throws_ok($$ insert into public.gyms (name, city) values ('Mine', 'Cluj') $$, '42501', null,
  'nobody inserts into gyms directly');
select throws_ok($$ select public.admin_save_gym(null, 'Sneaky', 'Cluj') $$, '42501', null,
  'a client cannot use the admin writer');

select pg_temp.authenticate_as('a1000000-0000-0000-0000-0000000000a1');
create temp table g as select
  public.admin_save_gym(null, 'Iron Temple', 'Cluj-Napoca', 'Str. Fabricii 1', 46.77, 23.6, 'https://maps.app.goo.gl/abc') as iron,
  public.admin_save_gym(null, 'Pulse Gym', 'Bucuresti') as pulse;
grant select on g to authenticated;
select throws_ok($$ select public.admin_save_gym(null, 'X', 'Cluj') $$, '22023', null, 'a one-letter name is refused');
select throws_ok($$ select public.admin_save_gym(null, 'Half', 'Cluj', null, 46.7, null) $$, '22023', null,
  'coordinates come in pairs');
select throws_ok($$ select public.admin_save_gym(null, 'Link', 'Cluj', null, null, null, 'javascript:alert(1)') $$, '22023', null,
  'a link must be https');

select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.gyms), 2, 'a signed-in user reads the active gyms');
select is((select name from public.search_gyms('iron')), 'Iron Temple', 'search finds a gym by name');
select is((select name from public.search_gyms('fabricii')), 'Iron Temple', 'and by address');
select is((select array_agg(name) from public.search_gyms(null)), array['Iron Temple'],
  'an empty query lists the caller''s own city');
select is((select count(*)::int from public.search_gyms('%')), 0, 'a % is a literal, not a wildcard');

-- ---------- 2. suggestions wait for an admin ----------
create temp table s as select public.suggest_gym('Garage Gym', 'Cluj-Napoca', null, null) as id;
grant select on s to authenticated;
select is((select status from public.gyms where id = (select id from s)), 'pending', 'a suggestion is pending');
select is((select count(*)::int from public.search_gyms('garage')), 1, 'its author finds their own pending suggestion');
select throws_ok($$ select public.set_home_gym((select id from s), false) $$, 'P0002', null,
  'a pending gym cannot be picked');
select pg_temp.authenticate_as('d2000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.gyms where id = (select id from s)), 0, 'someone else does not see it');
select pg_temp.authenticate_as('a1000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.admin_approve_gym((select id from s)) $$, 'an admin approves it');
select pg_temp.authenticate_as('d2000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.gyms where id = (select id from s)), 1, 'approved, everyone sees it');

-- ---------- 3. home gym and the opt-in board ----------
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000d1');
select throws_ok($$ update public.users set home_gym_id = (select iron from g) where id = auth.uid() $$, '42501', null,
  'home_gym_id is not writable through the table');
select lives_ok($$ select public.set_home_gym((select iron from g), true) $$, 'Ana picks Iron Temple and joins its board');
select pg_temp.authenticate_as('d2000000-0000-0000-0000-0000000000d2');
select lives_ok($$ select public.set_home_gym((select iron from g), false) $$, 'Ion picks Iron Temple, board off');
select pg_temp.authenticate_as('d3000000-0000-0000-0000-0000000000d3');
select lives_ok($$ select public.set_home_gym((select pulse from g), true) $$, 'Eva trains elsewhere');

select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000d1');
select is((select array_agg(username order by username) from public.social_leaderboard('workouts', 'week', 'gym')),
  array['ana'], 'Ana''s gym board: only those who opted in (Ion did not; Eva is at another gym)');
select is((select count(*)::int from public.social_leaderboard('workouts', 'week', 'global')), 3,
  'the global board is unchanged');
select pg_temp.authenticate_as('d2000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.social_leaderboard('workouts', 'week', 'gym')), 0,
  'Ion has not opted in, so he does not see the board either');
select lives_ok($$ select public.set_home_gym((select iron from g), true) $$, 'Ion opts in');
select is((select array_agg(username order by username) from public.social_leaderboard('workouts', 'week', 'gym')),
  array['ana', 'ion'], 'and now sees the opted-in members, himself included');
select pg_temp.authenticate_as('c1000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.social_leaderboard('workouts', 'week', 'gym')), 0,
  'no home gym → an empty gym board');
select throws_ok($$ select * from public.social_leaderboard('workouts', 'week', 'club') $$, '22023', null,
  'club is still not a scope');
select is((public.my_gyms() -> 'home'), 'null'::jsonb, 'my_gyms: a coach with no home gym');

-- ---------- 4. coaches at a gym (a published Discovery profile) ----------
select pg_temp.authenticate_as('c1000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select public.become_coach() $$, 'Coach C opens a coach profile');
select lives_ok($$ select public.coach_set_locations(jsonb_build_array(
  jsonb_build_object('city', 'cluj-napoca', 'gym_id', (select iron from g)))) $$,
  'and locates it at Iron Temple');
select is((select gym_name from public.coach_locations
           where coach_profile_id = (select id from public.coach_profiles where user_id = auth.uid())),
  'Iron Temple', 'the location shows the gym''s own name');
select throws_ok($$ select public.coach_set_locations(jsonb_build_array(
  jsonb_build_object('city', 'cluj-napoca', 'gym_id', gen_random_uuid()))) $$, '22023', null,
  'an unknown gym is refused');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.gym_coaches_at((select iron from g))), 0,
  'a draft profile is not listed at the gym');
reset role;
update public.coach_profiles set status = 'published', published_at = now()
 where user_id = 'c1000000-0000-0000-0000-0000000000c1';
create temp table cp as select id from public.coach_profiles where user_id = 'c1000000-0000-0000-0000-0000000000c1';
grant select on cp to authenticated;
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000d1');
select is((select display_name from public.gym_coaches_at((select iron from g))), 'coachc',
  'published, Coach C is listed at Ana''s gym');
select is((select coaches from public.search_gyms('iron')), 1, 'and counted on the gym');

-- ---------- 5. requests ----------
create temp table r as select public.request_coaching((select id from cp), null, 'Hi!', (select iron from g)) as id;
grant select on r to authenticated;
select throws_ok($$ select public.request_coaching((select id from cp)) $$, '23505', null,
  'one pending request per coach');
select is((select request_pending from public.gym_coaches_at((select iron from g))), true, 'the list shows it pending');
select is((select gym_name from public.my_coach_requests()), 'Iron Temple', 'Ana sees where she found him');
select pg_temp.authenticate_as('d2000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.coaching_requests), 0, 'a third person does not see the request');
select throws_ok($$ select public.accept_coaching_request((select id from r)) $$, '55000', null,
  'only the addressed coach can accept');
create temp table r2 as select public.request_coaching((select id from cp), null, null, null) as id;
grant select on r2 to authenticated;
select pg_temp.authenticate_as('c1000000-0000-0000-0000-0000000000c1');
select is((select gym_name from public.coach_request_inbox() where client_username = 'ana'), 'Iron Temple',
  'the coach''s inbox has Ana''s request and the gym');
select is(public.accept_coaching_request((select id from r)), 'accepted', 'the coach accepts');
select is(public.is_active_coach_of('d1000000-0000-0000-0000-0000000000d1'), true, 'the relationship is active');
select is((select trainer_client_id is not null from public.coaching_requests where id = (select id from r)), true,
  'the request records the relationship it became');
select is((select count(*)::int from public.conversations
           where coach_id = 'c1000000-0000-0000-0000-0000000000c1' and client_id = 'd1000000-0000-0000-0000-0000000000d1'), 1,
  'and a conversation exists');
select pg_temp.authenticate_as('d1000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select public.request_coaching((select id from cp)) $$, '55000', null,
  'a client with this coach cannot ask again (ALREADY_COACHED)');

-- Ion asked too, then got a coach by invite: accepting closes it instead.
reset role;
insert into public.trainer_clients (coach_id, client_id, status, started_at)
values ('c2000000-0000-0000-0000-0000000000c2', 'd2000000-0000-0000-0000-0000000000d2', 'active', now());
select pg_temp.authenticate_as('c1000000-0000-0000-0000-0000000000c1');
select is(public.accept_coaching_request((select id from r2)), 'already_has_coach',
  'a client who found a coach meanwhile is not accepted');
reset role;
select is((select status from public.coaching_requests where id = (select id from r2)), 'closed',
  'and the request is closed, not left pending');
select pg_temp.authenticate_as('d2000000-0000-0000-0000-0000000000d2');
select throws_ok($$ select public.request_coaching((select id from cp)) $$, '55000', null,
  'one active coach: someone with a coach cannot ask another (ALREADY_HAS_COACH)');

-- ---------- 6. deleting a gym ----------
reset role;
select pg_temp.authenticate_as('a1000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.admin_delete_gym((select iron from g)) $$, 'an admin deletes Iron Temple');
reset role;
select is((select count(*)::int from public.users where home_gym_id is null and gym_board
           and id in ('d1000000-0000-0000-0000-0000000000d1', 'd2000000-0000-0000-0000-0000000000d2')), 0,
  'its members lose it, and the board opt-in with it');
select is((select gym_name from public.coach_locations
           where coach_profile_id = (select id from cp)), 'Iron Temple',
  'the coach''s public location keeps its name');

select * from finish();
rollback;
