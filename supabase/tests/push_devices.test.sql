-- pgTAP · push devices (20261208100000): a phone registers itself only through
-- register_push_device(), sees only its owner's devices, leaves through
-- unregister_push_device(); a deletion request drops them; the dispatcher's
-- functions are service-role only, and its claim retires a stale backlog.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs push_devices

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c8000000-0000-0000-0000-000000000001', 'me@push.local',    '{"full_name":"Me","username":"me_push"}'),
  ('c8000000-0000-0000-0000-000000000002', 'other@push.local', '{"full_name":"Other","username":"other_push"}');

-- ---------- registering ----------
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.register_push_device('ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]', 'android', '1000') $$,
  'a signed-in person registers their phone');
select lives_ok(
  $$ select public.register_push_device('ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]', 'android', '1001') $$,
  'registering the same phone again is an update, not an error');
select is((select count(*) from public.push_devices), 1::bigint, 'one phone, one row');
select is((select app_build from public.push_devices), '1001', 'the build is refreshed');
select throws_ok(
  $$ select public.register_push_device('not a token', 'android', null) $$,
  '23514', null, 'only an Expo push token is accepted');
select throws_ok(
  $$ select public.register_push_device('ExponentPushToken[bbbbbbbbbbbbbbbbbbbb]', 'windows', null) $$,
  '23514', null, 'only android or ios');
select throws_ok(
  $$ insert into public.push_devices (user_id, token, platform)
     values ('c8000000-0000-0000-0000-000000000001', 'ExponentPushToken[cccccccccccccccccccc]', 'android') $$,
  '42501', null, 'no direct insert: the function is the only way in');

-- ---------- someone else ----------
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000002');
select is((select count(*) from public.push_devices), 0::bigint, 'another person sees none of my devices');
select lives_ok($$ select public.unregister_push_device('ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]') $$,
  'unregistering someone else''s token is not an error…');
reset role;
select is((select count(*) from public.push_devices where user_id = 'c8000000-0000-0000-0000-000000000001'), 1::bigint,
  '…and removes nothing');

-- A phone that changed hands moves to its new owner.
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000002');
select public.register_push_device('ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]', 'android', '1001');
reset role;
select is((select user_id::text from public.push_devices where token = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]'),
  'c8000000-0000-0000-0000-000000000002', 'signing in on a used phone takes its token over');

-- ---------- leaving ----------
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000002');
select public.unregister_push_device('ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]');
reset role;
select is((select count(*) from public.push_devices), 0::bigint, 'signing out removes the phone');

-- ---------- anon and the dispatcher's doors ----------
select ok(not has_function_privilege('anon', 'public.register_push_device(text, text, text)', 'execute'), 'anon: no register');
select ok(not has_function_privilege('authenticated', 'public.claim_push_batch(int)', 'execute'), 'users: no claim_push_batch');
select ok(not has_function_privilege('authenticated', 'public.mark_pushed(uuid[])', 'execute'), 'users: no mark_pushed');
select ok(not has_function_privilege('authenticated', 'public.forget_push_tokens(text[])', 'execute'), 'users: no forget_push_tokens');
select ok(not has_function_privilege('authenticated', 'public.tick_push_dispatch()', 'execute'), 'users: no tick');

-- ---------- the claim ----------
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');
select public.register_push_device('ExponentPushToken[dddddddddddddddddddd]', 'android', '1000');
reset role;
insert into public.notifications (id, user_id, category, title, created_at) values
  ('e8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', 'new_message', 'fresh', now()),
  ('e8000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000001', 'new_message', 'stale', now() - interval '2 days'),
  ('e8000000-0000-0000-0000-000000000003', 'c8000000-0000-0000-0000-000000000002', 'new_message', 'no phone', now());

select is((select array_agg(title order by title) from public.claim_push_batch(100)), array['fresh'],
  'the claim returns only fresh rows of people with a phone');
select ok((select sent_at is not null from public.notifications where id = 'e8000000-0000-0000-0000-000000000002'),
  'a stale row is retired without a push');
select ok((select sent_at is not null from public.notifications where id = 'e8000000-0000-0000-0000-000000000003'),
  'a row for someone without a phone is retired as in-app history');
select is((select tokens from public.claim_push_batch(100)), array['ExponentPushToken[dddddddddddddddddddd]'],
  'the claim carries the person''s tokens');

-- ---------- deletion ----------
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');
select public.request_account_deletion();
reset role;
select is((select count(*) from public.push_devices where user_id = 'c8000000-0000-0000-0000-000000000001'), 0::bigint,
  'a deletion request drops the person''s phones at once');

select * from finish();
rollback;
