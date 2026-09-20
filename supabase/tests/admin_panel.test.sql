-- pgTAP · admin panel: only an admin reaches the admin RPCs, the audit log is
-- written by triggers and admin actions and edited by nobody, and the
-- aggregations the panel shows add up.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(101);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-00000000000a', 'admin@adm.local',  '{"full_name":"Ada Admin","username":"ada_admin"}'),
  ('e1000000-0000-0000-0000-00000000000c', 'coach@adm.local',  '{"full_name":"Cory Coach","username":"cory_coach","role":"coach"}'),
  ('e1000000-0000-0000-0000-000000000001', 'one@adm.local',    '{"full_name":"Client One","username":"client_one"}'),
  ('e1000000-0000-0000-0000-000000000002', 'two@adm.local',    '{"full_name":"Client Two","username":"client_two"}'),
  ('e1000000-0000-0000-0000-000000000003', 'three@adm.local',  '{"full_name":"Client Three","username":"client_three"}');
update public.users set role = 'admin' where id = 'e1000000-0000-0000-0000-00000000000a';
update public.users set created_at = now() - interval '40 days' where id = 'e1000000-0000-0000-0000-000000000003';

-- one active pair, one pending invite, one expired invite
insert into public.trainer_clients (id, coach_id, client_id, status, started_at) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-000000000001', 'active', now() - interval '10 days');
insert into public.trainer_clients (id, coach_id, status, invite_code, invite_expires_at) values
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000c', 'invited', 'PENDING1', now() + interval '10 days'),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-00000000000c', 'invited', 'EXPIRED1', now() - interval '1 day');

insert into public.exercises (id, name_en, source) values
  ('e3000000-0000-0000-0000-000000000001', 'Bench Press', 'custom');
update public.exercises set owner_id = null where id = 'e3000000-0000-0000-0000-000000000001';

-- client one: two completed workouts (one today, one 3 days ago) with sets
insert into public.logged_sessions (id, user_id, client_generated_id, started_at, completed_at) values
  ('e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', now() - interval '1 hour', now() - interval '10 minutes'),
  ('e4000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000002', now() - interval '3 days', now() - interval '3 days' + interval '45 minutes');
insert into public.logged_sets (id, session_id, user_id, exercise_id, client_generated_id, set_index, reps, weight_kg, received_at) values
  ('e5000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 1, 8, 110, now() - interval '50 minutes'),
  ('e5000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000002', 2, 8, 110, now() - interval '40 minutes'),
  ('e5000000-0000-0000-0000-000000000003', 'e4000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000003', 1, 5, 100, now() - interval '3 days' + interval '10 minutes');

-- a post by client two, kudos from client one
insert into public.social_posts (id, user_id, type, text, visibility) values
  ('e6000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'text', 'hello feed', 'public');
insert into public.social_reactions (post_id, user_id) values
  ('e6000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001');

-- a login, as GoTrue would record it
update auth.users set last_sign_in_at = now() where id = 'e1000000-0000-0000-0000-000000000001';
insert into auth.audit_log_entries (payload, created_at) values
  (json_build_object('action', 'login', 'actor_id', 'e1000000-0000-0000-0000-000000000001', 'traits', json_build_object('provider', 'email')), now());

-- ============================================================
-- 1. security: who may call the admin RPCs
-- ============================================================
select pg_temp.authenticate_as('e1000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.admin_overview() $$, '42501', null, 'a client cannot call admin_overview');
select throws_ok($$ select public.admin_users() $$, '42501', null, 'a client cannot call admin_users');
select throws_ok($$ select public.admin_user_detail('e1000000-0000-0000-0000-000000000002') $$, '42501', null, 'a client cannot read another user''s detail');
select throws_ok($$ select public.admin_audit_log() $$, '42501', null, 'a client cannot read the audit log');
select throws_ok($$ select public.admin_set_suspended('e1000000-0000-0000-0000-000000000002', true) $$, '42501', null, 'a client cannot suspend anyone');
select throws_ok($$ select public.admin_search('client') $$, '42501', null, 'a client cannot use admin search');
select is((select count(*) from public.admin_audit_events), 0::bigint, 'a client sees no audit rows through RLS');
select throws_ok(
  $$ update public.users set role = 'admin' where id = 'e1000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a client cannot promote themselves');
select throws_ok(
  $$ update public.users set suspended_at = null where id = 'e1000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'a client cannot touch their own suspension flag');

reset role;
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000c');
select throws_ok($$ select public.admin_overview() $$, '42501', null, 'a coach cannot call admin_overview');
select throws_ok($$ select public.admin_users() $$, '42501', null, 'a coach cannot call admin_users');
select throws_ok($$ select public.admin_invitations() $$, '42501', null, 'a coach cannot list every invitation');
select throws_ok($$ select public.admin_delete_post('e6000000-0000-0000-0000-000000000001') $$, '42501', null, 'a coach cannot delete a post');
select throws_ok(
  $$ update public.users set role = 'admin' where id = 'e1000000-0000-0000-0000-00000000000c' $$,
  '42501', null, 'a coach cannot promote themselves');

reset role;
select pg_temp.anonymous();
select throws_ok($$ select public.admin_overview() $$, '42501', null, 'an anonymous caller cannot call admin_overview');
select throws_ok($$ select public.admin_user_detail('e1000000-0000-0000-0000-000000000001') $$, '42501', null, 'an anonymous caller cannot read a user');
select lives_ok($$ select public.record_login_failure('one@adm.local', '203.0.113.9', 'pgTAP') $$, 'an anonymous caller may report a failed login');

reset role;
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.admin_overview() $$, 'an admin can call admin_overview');
select lives_ok($$ select public.admin_users() $$, 'an admin can call admin_users');
select is((select (public.admin_user_detail('e1000000-0000-0000-0000-000000000001') -> 'account' ->> 'email')),
  'one@adm.local', 'an admin sees the email through the RPC, never through the table');

-- ============================================================
-- 2. audit log
-- ============================================================
select is((select count(*) from public.admin_audit_events where action = 'USER_CREATED'), 5::bigint,
  'sign-up writes USER_CREATED per user');
select is((select count(*) from public.admin_audit_events where action = 'ROLE_CHANGED' and target_user_id = 'e1000000-0000-0000-0000-00000000000a'), 1::bigint,
  'promoting the admin wrote ROLE_CHANGED');
select is((select count(*) from public.admin_audit_events where action = 'USER_LOGIN' and target_user_id = 'e1000000-0000-0000-0000-000000000001'), 1::bigint,
  'a login stamp writes USER_LOGIN');
select is((select metadata ->> 'provider' from public.admin_audit_events where action = 'USER_LOGIN' limit 1), 'email',
  '…with the provider');
select is((select count(*) from public.admin_audit_events where action = 'SET_LOGGED'), 3::bigint, 'each set logged is an event');
select is((select metadata ->> 'exercise' from public.admin_audit_events where action = 'SET_LOGGED' limit 1), 'Bench Press',
  'set events carry the exercise name');
select is((select count(*) from public.admin_audit_events where action = 'POST_CREATED'), 1::bigint, 'a post is an event');
select is((select count(*) from public.admin_audit_events where action = 'KUDOS_ADDED' and actor_user_id = 'e1000000-0000-0000-0000-000000000001'), 1::bigint,
  'kudos is an event with the giver as actor');
select is((select count(*) from public.admin_audit_events where action = 'INVITATION_CREATED'), 3::bigint, 'invitations are events');
select is((select count(*) from public.admin_audit_events where action = 'LOGIN_FAILED'), 1::bigint, 'the failed login was recorded');
select is((select target_user_id from public.admin_audit_events where action = 'LOGIN_FAILED'), 'e1000000-0000-0000-0000-000000000001'::uuid,
  '…and resolved to the account it named');
select is((select ip from public.admin_audit_events where action = 'LOGIN_FAILED'), '203.0.113.9', '…with the IP');

-- an admin action creates an event that preserves the actor
select lives_ok($$ select public.admin_set_suspended('e1000000-0000-0000-0000-000000000002', true, 'spam') $$, 'an admin can suspend a client');
select is((select suspended_at is not null from public.users where id = 'e1000000-0000-0000-0000-000000000002'), true, '…and the flag is set');
select is((select actor_user_id from public.admin_audit_events where action = 'USER_SUSPENDED'), 'e1000000-0000-0000-0000-00000000000a'::uuid,
  'the suspension event names the admin as actor');
select is((select actor_role from public.admin_audit_events where action = 'USER_SUSPENDED'), 'admin', '…with their role');
select is((select metadata ->> 'reason' from public.admin_audit_events where action = 'USER_SUSPENDED'), 'spam', '…and the reason');
select throws_ok($$ select public.admin_set_suspended('e1000000-0000-0000-0000-00000000000a', true) $$, '22023', null, 'an admin cannot suspend themselves');
select lives_ok($$ select public.admin_set_suspended('e1000000-0000-0000-0000-000000000002', false) $$, 'an admin can reactivate');
select is((select count(*) from public.admin_audit_events where action = 'USER_REACTIVATED'), 1::bigint, 'reactivation is logged');

select lives_ok($$ select public.admin_delete_post('e6000000-0000-0000-0000-000000000001', 'off topic') $$, 'an admin can soft-delete a post');
-- the row is still there (RLS hides a deleted post from the table read, so ask the RPC)
select is((select (public.admin_social_post('e6000000-0000-0000-0000-000000000001') ->> 'deleted_at') is not null), true, '…it is a soft delete');
select is((select metadata ->> 'by_admin' from public.admin_audit_events where action = 'POST_DELETED'), 'true', 'the post event says an admin did it');
select throws_ok($$ select public.admin_delete_post('e6000000-0000-0000-0000-000000000001') $$, '22023', null, 'deleting it twice is refused');

select lives_ok($$ select public.admin_revoke_invitation('e2000000-0000-0000-0000-000000000002') $$, 'an admin can revoke a pending invitation');
select is((select status from public.trainer_clients where id = 'e2000000-0000-0000-0000-000000000002'), 'ended'::relationship_status, '…which ends it');
select throws_ok($$ select public.admin_revoke_invitation('e2000000-0000-0000-0000-000000000001') $$, '22023', null, 'an active relationship is not an invitation to revoke');

-- append-only: nobody through the API edits history
select throws_ok($$ update public.admin_audit_events set metadata = '{}' where action = 'USER_SUSPENDED' $$, '42501', null,
  'even an admin cannot edit an audit row');
select throws_ok($$ delete from public.admin_audit_events where action = 'USER_SUSPENDED' $$, '42501', null,
  'even an admin cannot delete an audit row');
select throws_ok($$ insert into public.admin_audit_events (action) values ('ADMIN_ACTION') $$, '42501', null,
  'nobody inserts directly');
reset role;
select pg_temp.authenticate_as('e1000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.admin_audit_events set metadata = '{}' $$, '42501', null, 'a normal user cannot edit audit rows');
select throws_ok($$ delete from public.admin_audit_events $$, '42501', null, 'a normal user cannot delete audit rows');

-- ============================================================
-- 3. users list: pagination, filters, search, roles
-- ============================================================
reset role;
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');
select is((select (public.admin_users() ->> 'total')::int), 5, 'the directory counts every user');
select is((select jsonb_array_length(public.admin_users(p_limit => 2) -> 'rows')), 2, 'pagination honours the limit');
select is((select (public.admin_users(p_limit => 2, p_offset => 4) -> 'rows' -> 0 ->> 'id')),
  (select id::text from public.users order by created_at desc offset 4 limit 1), 'the offset moves through the newest-first order');
select is((select (public.admin_users(p_role => 'coach') ->> 'total')::int), 1, 'the role filter finds the coach');
select is((select (public.admin_users(p_role => 'admin') -> 'rows' -> 0 ->> 'role')), 'admin', 'the role is reported as stored');
select is((select (public.admin_users(p_coach => 'with') ->> 'total')::int), 1, 'has-coach finds the one active pair');
select is((select (public.admin_users(p_search => 'two@adm') -> 'rows' -> 0 ->> 'username')), 'client_two', 'search matches the email');
select is((select (public.admin_users(p_search => 'client_th') ->> 'total')::int), 1, 'search matches the username');
select is((select (public.admin_users(p_search => 'e1000000-0000-0000-0000-000000000003') ->> 'total')::int), 1, 'search matches the id');
select is((select (public.admin_users(p_created_days => 7) ->> 'total')::int), 4, 'created-within excludes the 40-day-old account');
select is((select (public.admin_users(p_sort => 'most_workouts') -> 'rows' -> 0 ->> 'username')), 'client_one', 'most-workouts sort puts the lifter first');
select is((select (public.admin_users(p_sort => 'most_workouts') -> 'rows' -> 0 ->> 'workouts')::int), 2, '…with the completed count');

-- ============================================================
-- 4. invitations
-- ============================================================
select is((select (public.admin_invitations() -> 'stats' ->> 'expired')::int), 1, 'one invitation is expired');
select is((select (public.admin_invitations() -> 'stats' ->> 'accepted')::int), 1, 'one was accepted');
select is((select (public.admin_invitations(p_status => 'expired') -> 'rows' -> 0 ->> 'status')), 'expired', 'the status filter works and labels the row');
select is((select (public.admin_invitations() -> 'stats' ->> 'acceptance_rate')::numeric), 33.3, 'acceptance rate = accepted / total');

-- ============================================================
-- 5. dashboard aggregation and date ranges
-- ============================================================
select is((select (public.admin_overview() -> 'users' ->> 'total')::int), 5, 'overview: total users');
select is((select (public.admin_overview() -> 'activity' ->> 'workouts_7d')::int), 2, 'overview: workouts in the last 7 days');
select is((select (public.admin_overview() -> 'activity' ->> 'sets_today')::int), 2, 'overview: sets today');
select is((select (public.admin_overview() -> 'auth' ->> 'logins_total')::int), 1, 'overview: logins from the auth audit log');
select is((select sum(workouts)::int from public.admin_daily_series(7)), 2, 'daily series over 7 days sums the two workouts');
select is((select sum(workouts)::int from public.admin_daily_series(2)), 1, 'a 2-day window sees only the recent one');
select is((select count(*)::int from public.admin_daily_series(10)), 10, 'the series has one row per day');
select is((select count(*)::int from public.admin_user_timeline('e1000000-0000-0000-0000-000000000001')
           ), (select 2 + 2 + 3 + 1 + 1 + 1 + 1 + 1), -- started×2, completed×2, sets×3, kudos, coach_joined, USER_CREATED, USER_LOGIN, LOGIN_FAILED
  'the timeline unions the real tables and the audit-only events');
select is((select jsonb_array_length(public.admin_search('client_') -> 'users')), 3, 'search finds the three clients');
select is((select jsonb_array_length(public.admin_search('Bench') -> 'exercises')), 1, 'search finds the exercise');

-- ============================================================
-- 6. every other read answers for an admin (shape smoke)
-- ============================================================
reset role;
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) values
  ('e7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'https://push.example/adm', 'k', 'a', 'Mozilla/5.0 Chrome/120');
insert into public.challenges (id, title_en, title_ro, type, target_value, start_date, end_date) values
  ('e8000000-0000-0000-0000-000000000001', 'Ten workouts', 'Zece antrenamente', 'workouts', 10, current_date - 5, current_date + 5);
insert into public.challenge_participants (challenge_id, user_id) values
  ('e8000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001');
insert into public.foods (id, source, owner_id, name_en, kcal_100g) values
  ('e9000000-0000-0000-0000-000000000001', 'custom', 'e1000000-0000-0000-0000-000000000001', 'Mystery bar', 0);
insert into public.food_logs (user_id, date, slot, food_id, food_name, grams, kcal, method, client_generated_id) values
  ('e1000000-0000-0000-0000-000000000001', current_date, 'lunch', 'e9000000-0000-0000-0000-000000000001', 'Mystery bar', 50, 0, 'barcode', 'ea000000-0000-0000-0000-000000000001');
select pg_temp.authenticate_as('e1000000-0000-0000-0000-00000000000a');

select is((select (public.admin_auth_stats() ->> 'logins_total')::int), 1, 'admin_auth_stats counts the login');
select is((select (public.admin_auth_stats() -> 'logins_by_provider_30d' ->> 'email')::int), 1, '…by provider');
select is((select (public.admin_workout_stats(30) ->> 'completed')::int), 2, 'admin_workout_stats counts completed sessions');
select is((select (public.admin_workout_stats(30) -> 'top_exercises' -> 0 ->> 'name')), 'Bench Press', '…and ranks the exercise');
select is((select (public.admin_exercises(p_search => 'bench') ->> 'total')::int), 1, 'admin_exercises searches');
select is((select (public.admin_exercises() -> 'rows' -> 0 ->> 'logged_sets')::int), 3, '…and counts the sets that reference it');
select is((select (public.admin_nutrition_stats(30) ->> 'foods_no_kcal')::int), 1, 'admin_nutrition_stats flags the food without kcal');
select is((select (public.admin_nutrition_stats(30) -> 'logs_by_method' ->> 'barcode')::int), 1, '…and counts barcode logs');
select is((select (public.admin_social_posts(p_status => 'deleted') ->> 'total')::int), 1, 'admin_social_posts filters deleted posts');
select is((select (public.admin_social_posts() -> 'stats' ->> 'kudos')::int), 1, '…with kudos in the stats');
-- the challenges migration seeds platform challenges too, so only a lower bound is stable
select ok((select (public.admin_challenges() -> 'stats' ->> 'active')::int) >= 1, 'admin_challenges sees the active challenge');
select is((select (public.admin_challenge_detail('e8000000-0000-0000-0000-000000000001') -> 'participants' -> 0 ->> 'workouts')::int), 2,
  'admin_challenge_detail folds the participant''s workouts in the window');
select is((select (public.admin_notification_stats() ->> 'users_with_push')::int), 1, 'admin_notification_stats counts subscribed users');
select is((select (public.admin_notification_stats() -> 'by_browser' ->> 'Chrome')::int), 1, '…by browser family');
select is((select (public.admin_system_health() ->> 'latest_migration') is not null), true, 'admin_system_health reports the schema version');
select is((select count(*)::int from public.admin_user_load_sessions('e1000000-0000-0000-0000-000000000001', 57)), 2,
  'admin_user_load_sessions returns the completed sessions');
select lives_ok($$ select public.admin_remove_push_subscription('e7000000-0000-0000-0000-000000000001') $$, 'an admin can drop a push subscription');
select is((select count(*) from public.admin_audit_events where action = 'PUSH_UNSUBSCRIBED'), 1::bigint, '…which the trigger logs as unsubscribed');
select is((select count(*) from public.admin_audit_events where action = 'ADMIN_ACTION' and metadata ->> 'kind' = 'remove_push_subscription'), 1::bigint,
  '…and the RPC logs as an admin action');
select is((select (public.admin_user_detail('e1000000-0000-0000-0000-000000000001') -> 'nutrition' ->> 'food_logs')::int), 1,
  'admin_user_detail: nutrition section');
select is((select (public.admin_user_detail('e1000000-0000-0000-0000-000000000001') -> 'coaching' -> 'current_coach' ->> 'username')), 'cory_coach',
  'admin_user_detail: coaching section');
select is((select (public.admin_user_detail('e1000000-0000-0000-0000-000000000001') -> 'auth' ->> 'logins_total')::int), 1,
  'admin_user_detail: auth section');
select is((select public.admin_user_detail('00000000-0000-0000-0000-000000000000')), null::jsonb, 'an unknown id is null, not an error');

select * from finish();
rollback;
