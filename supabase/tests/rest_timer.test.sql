-- pgTAP · rest timer: prefs are the person's to edit, push subscriptions and
-- scheduled pushes are owner-only, and a due push is claimed exactly once.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('c4000000-0000-0000-0000-000000000001', 'me@rest.local',    '{"full_name":"Me","username":"me_rest"}'),
  ('c4000000-0000-0000-0000-000000000002', 'other@rest.local', '{"full_name":"Other","username":"other_rest"}');

-- ---------- rest_prefs ----------
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ update public.users
        set rest_prefs = '{"default_seconds": 90, "notify": true, "exercises": {"11111111-1111-1111-1111-111111111111": 120}}'
      where id = 'c4000000-0000-0000-0000-000000000001' $$,
  'a user can save their own rest settings');
select is((select rest_prefs ->> 'default_seconds' from public.users where id = 'c4000000-0000-0000-0000-000000000001'),
  '90', 'the settings round-trip');
select throws_ok(
  $$ update public.users set rest_prefs = '[1,2,3]' where id = 'c4000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'rest_prefs must be a json object');

-- RLS filters the other row out: the write is silently a no-op, not an error.
update public.users set rest_prefs = '{"default_seconds": 5}' where id = 'c4000000-0000-0000-0000-000000000002';
select is((select rest_prefs::text from public.users where id = 'c4000000-0000-0000-0000-000000000002'),
  null, 'someone else''s rest settings cannot be written (and cannot be read)');

-- ---------- push_subscriptions ----------
select lives_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ('c4000000-0000-0000-0000-000000000001', 'https://push.example/one', 'p256dh-one', 'auth-one') $$,
  'a user can register their own browser for push');
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ('c4000000-0000-0000-0000-000000000002', 'https://push.example/forged', 'x', 'y') $$,
  '42501', null, 'a user cannot register a subscription in someone else''s name');
select throws_ok(
  $$ insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
     values ('c4000000-0000-0000-0000-000000000001', 'http://push.example/plain', 'x', 'y') $$,
  '23514', null, 'a push endpoint must be https');

reset role;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('c4000000-0000-0000-0000-000000000002', 'https://push.example/two', 'p256dh-two', 'auth-two');
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');

select is((select count(*) from public.push_subscriptions), 1::bigint,
  'a user sees only their own subscriptions');
update public.push_subscriptions set auth = 'stolen' where endpoint = 'https://push.example/two';
delete from public.push_subscriptions where endpoint = 'https://push.example/two';
reset role;
select is((select auth from public.push_subscriptions where endpoint = 'https://push.example/two'), 'auth-two',
  'someone else''s subscription can be neither changed nor deleted');

-- ---------- rest_pushes ----------
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into public.rest_pushes (id, user_id, notify_at, title, body, url)
     values ('d4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001',
             now() - interval '1 second', 'Rest finished', 'Time for your next set.', '/workout/x/log') $$,
  'a user can schedule their own rest push');
select throws_ok(
  $$ insert into public.rest_pushes (id, user_id, notify_at, title, body, url)
     values ('d4000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000002',
             now(), 'Rest finished', 'Time for your next set.', '/workout/x/log') $$,
  '42501', null, 'a user cannot schedule a push for someone else');
select throws_ok(
  $$ insert into public.rest_pushes (id, user_id, notify_at, title, body, url)
     values ('d4000000-0000-0000-0000-000000000003', 'c4000000-0000-0000-0000-000000000001',
             now(), 'Rest finished', 'Time for your next set.', 'https://evil.example/phish') $$,
  '23514', null, 'the click target must be a same-origin path');

-- A second, cancelled one and a third still in the future.
insert into public.rest_pushes (id, user_id, notify_at, title, body, url, cancelled_at)
  values ('d4000000-0000-0000-0000-000000000004', 'c4000000-0000-0000-0000-000000000001',
          now() - interval '1 second', 'Rest finished', 'Time for your next set.', '/workout/x/log', now());
insert into public.rest_pushes (id, user_id, notify_at, title, body, url)
  values ('d4000000-0000-0000-0000-000000000005', 'c4000000-0000-0000-0000-000000000001',
          now() + interval '1 hour', 'Rest finished', 'Time for your next set.', '/workout/x/log');

-- Skipping the rest = cancelling the push, on your own row only.
select lives_ok(
  $$ update public.rest_pushes set cancelled_at = now() where id = 'd4000000-0000-0000-0000-000000000005' $$,
  'a user can cancel their own scheduled push');

select throws_ok(
  $$ select * from public.claim_due_rest_pushes() $$,
  '42501', null, 'a signed-in user cannot claim pushes — that is the sender''s job');
select throws_ok(
  $$ select public.tick_rest_pushes() $$,
  '42501', null, '…nor run the cron tick');

reset role;
insert into public.rest_pushes (id, user_id, notify_at, title, body, url)
  values ('d4000000-0000-0000-0000-000000000006', 'c4000000-0000-0000-0000-000000000002',
          now() - interval '5 seconds', 'Pauza s-a terminat', 'Poți începe următorul set.', '/workout/y/log');

-- ---------- the sender claims each due push once ----------
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000002');
select is((select count(*) from public.rest_pushes), 1::bigint,
  'a user sees only their own scheduled pushes');
reset role;

select set_eq(
  $$ select id from public.claim_due_rest_pushes() $$,
  $$ values ('d4000000-0000-0000-0000-000000000001'::uuid), ('d4000000-0000-0000-0000-000000000006'::uuid) $$,
  'the sender gets exactly the due, uncancelled pushes');
select is((select count(*) from public.claim_due_rest_pushes()), 0::bigint,
  'claiming again returns nothing — one push per rest, ever');
select isnt((select sent_at from public.rest_pushes where id = 'd4000000-0000-0000-0000-000000000001'), null,
  'a claimed push is marked sent');
select is((select sent_at from public.rest_pushes where id = 'd4000000-0000-0000-0000-000000000004'), null,
  'a cancelled push is never sent');

-- The tick is safe to run anywhere: with no vault / no pg_net it just returns.
select lives_ok($$ select public.tick_rest_pushes() $$, 'the cron tick runs without the delivery plumbing');

-- ---------- secrets stay server-side ----------
select ok(
  case when exists (select 1 from pg_namespace where nspname = 'vault')
       then not has_schema_privilege('authenticated', 'vault', 'usage')
       else true end,
  'signed-in users cannot reach the vault that holds the sender''s credentials');
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name ilike '%vapid%'),
  0::bigint, 'no VAPID material is stored in any public table');

select * from finish();
rollback;
