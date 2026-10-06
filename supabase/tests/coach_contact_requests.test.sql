-- pgTAP · Contact / consultation requests (20261103100000)
--
-- A request is interest, not a relationship: send (optional service, goal,
-- format), one pending per coach, never yourself or an invisible coach;
-- the coach accepts or declines, the client cancels; accepting makes nobody
-- a client — starting is a separate step. Each move notifies the other side
-- through the existing notifications table; each side reads only its own.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_contact_requests

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
create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$fn$;

-- 01 coach K · 02 client C · 03 another coach M · 04 a stranger S · 05 a draft coach D
insert into auth.users (id, email, raw_user_meta_data) values
  ('c8000000-0000-0000-0000-000000000001'::uuid, 'kai@contact.local',  '{"full_name":"Kai","username":"kai_contact"}'),
  ('c8000000-0000-0000-0000-000000000002'::uuid, 'cleo@contact.local', '{"full_name":"Cleo","username":"cleo_contact"}'),
  ('c8000000-0000-0000-0000-000000000003'::uuid, 'max@contact.local',  '{"full_name":"Max","username":"max_contact"}'),
  ('c8000000-0000-0000-0000-000000000004'::uuid, 'sam@contact.local',  '{"full_name":"Sam","username":"sam_contact"}'),
  ('c8000000-0000-0000-0000-000000000005'::uuid, 'dee@contact.local',  '{"full_name":"Dee","username":"dee_contact"}');
update public.users set city = 'Secret Town' where id = 'c8000000-0000-0000-0000-000000000002';

select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000003'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000005'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'K', online = true
 where slug in ('kai-contact', 'max-contact');
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit)
select 'c8500000-0000-0000-0000-000000000001', id, 'Online coaching', 30000, 'month' from public.coach_profiles where slug = 'kai-contact';
create temp table ids as select slug, id from public.coach_profiles;
grant select on ids to authenticated, anon;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$ select id from ids where slug = p_slug; $fn$;
create or replace function pg_temp.notices(p_user uuid, p_event text) returns int language sql security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = 'coaching_request' and payload ->> 'event' = p_event;
$fn$;

-- ============================================================================
-- 1. sending
-- ============================================================================
select pg_temp.anonymous();
select throws_ok($$ select public.request_coaching(pg_temp.pid('kai-contact'), null, 'hi') $$,
  '42501', null, 'an anonymous visitor cannot send a request');
reset role;

select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.request_coaching(pg_temp.pid('dee-contact'), null, 'hi') $$,
  'P0002', 'COACH_NOT_FOUND', 'a coach who is not public cannot be contacted');
select throws_ok($$ select public.request_coaching('c8999999-0000-0000-0000-000000000000', null, 'hi') $$,
  'P0002', 'COACH_NOT_FOUND', 'a coach who does not exist cannot be contacted');
select throws_ok($$ select public.request_coaching(pg_temp.pid('kai-contact'), null, 'hi', null, repeat('g', 301)) $$,
  '22023', 'GOAL_TOO_LONG', 'a goal over 300 characters is refused');
select throws_ok($$ select public.request_coaching(pg_temp.pid('kai-contact'), null, 'hi', null, null, 'by_post') $$,
  '22023', 'INVALID_FORMAT', 'an unknown format is refused');
select throws_ok($$ select public.request_coaching(pg_temp.pid('kai-contact'), 'c8500000-0000-0000-0000-0000000000ff', 'hi') $$,
  '22023', 'UNKNOWN_SERVICE', 'a service that is not this coach''s is refused');
select throws_ok($$ insert into public.coaching_requests (client_id, coach_id) values (auth.uid(), 'c8000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'nobody writes the table directly');

create temp table r1 as select public.request_coaching(pg_temp.pid('kai-contact'), 'c8500000-0000-0000-0000-000000000001',
  'Looking for strength coaching.', null, 'Deadlift 150 kg', 'online') as id;
grant select on r1 to authenticated;
select is((select service_id::text || '|' || goal || '|' || preferred_format from public.coaching_requests where id = (select id from r1)),
  'c8500000-0000-0000-0000-000000000001|Deadlift 150 kg|online', 'a request with a service, a goal and a format');
select is((select status from public.coaching_requests where id = (select id from r1)), 'pending', 'it starts pending');
select throws_ok($$ select public.request_coaching(pg_temp.pid('kai-contact'), null, 'again?') $$,
  '23505', 'REQUEST_PENDING', 'a second pending request to the same coach is refused');
select lives_ok($$ select public.request_coaching(pg_temp.pid('max-contact')) $$,
  'a request without any optional field is fine');
select is((select count(*)::int from public.my_coaching_requests()), 2, 'the client sees both of their requests');
select is((select status || '|' || coalesce(service_name, '') from public.my_coaching_requests() where coach_slug = 'kai-contact'),
  'pending|Online coaching', 'with status and service');
select is(public.coach_viewer_state(pg_temp.pid('kai-contact')) #>> '{last_request,status}', 'pending',
  'the profile''s CTA knows the request is pending');
reset role;

select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.request_coaching(pg_temp.pid('kai-contact'), null, 'me') $$,
  '22023', 'CANNOT_REQUEST_SELF', 'a coach cannot contact themselves');
reset role;
select is(pg_temp.notices('c8000000-0000-0000-0000-000000000001', 'sent'), 1, 'the coach is notified of the request');
select is((select payload ->> 'screen' from public.notifications
           where user_id = 'c8000000-0000-0000-0000-000000000001' and category::text = 'coaching_request'), 'coach_requests',
  'and the notice opens their requests');

-- ============================================================================
-- 2. who reads what
-- ============================================================================
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.coach_requests()), 1, 'the coach reads the request addressed to them');
select is((select client_name || '|' || message || '|' || goal from public.coach_requests()),
  'cleo_contact|Looking for strength coaching.|Deadlift 150 kg', 'what the client chose to send');
select ok(position('Secret Town' in (select row_to_json(x)::text from public.coach_requests() x)) = 0
          and position('@' in (select row_to_json(x)::text from public.coach_requests() x)) = 0,
  'and nothing else: no city, no e-mail');
reset role;
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.coach_requests() where id = (select id from r1)), 0,
  'another coach does not read it');
select throws_ok($$ select public.accept_coaching_request((select id from r1)) $$, '55000', 'REQUEST_NOT_PENDING',
  'nor accept it');
select throws_ok($$ select public.decline_coaching_request((select id from r1)) $$, '55000', 'REQUEST_NOT_PENDING',
  'nor decline it');
reset role;
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.coaching_requests), 0, 'a stranger reads no request');
select is((select count(*)::int from public.my_coaching_requests()), 0, 'and has none of their own');
select throws_ok($$ select public.cancel_coaching_request((select id from r1)) $$, '55000', 'REQUEST_NOT_PENDING',
  'nor cancels someone else''s');
reset role;
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.accept_coaching_request((select id from r1)) $$, '55000', 'REQUEST_NOT_PENDING',
  'the client cannot accept their own request');
select throws_ok($$ update public.coaching_requests set status = 'accepted' $$, '42501', null,
  'nor set its status directly');
reset role;

-- ============================================================================
-- 3. accept: interested, not a client
-- ============================================================================
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');
select is(public.accept_coaching_request((select id from r1)), 'accepted', 'the coach accepts');
select is((select status from public.coaching_requests where id = (select id from r1)), 'accepted', 'pending → accepted');
select is(public.is_active_coach_of('c8000000-0000-0000-0000-000000000002'), false, 'accepting makes nobody a client');
select throws_ok($$ select public.decline_coaching_request((select id from r1)) $$, '55000', 'REQUEST_NOT_PENDING',
  'an accepted request cannot be declined');
reset role;
select is(pg_temp.notices('c8000000-0000-0000-0000-000000000002', 'accepted'), 1, 'the client is notified');
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000002');
select is(public.coach_viewer_state(pg_temp.pid('kai-contact')) #>> '{last_request,status}', 'accepted',
  'the profile''s CTA knows it was accepted');
select throws_ok($$ select public.cancel_coaching_request((select id from r1)) $$, '55000', 'REQUEST_NOT_PENDING',
  'an accepted request cannot be cancelled');
select throws_ok($$ select public.start_coaching_from_request((select id from r1)) $$, '55000', 'REQUEST_NOT_ACCEPTED',
  'the client cannot start coaching from it');
reset role;

-- the explicit second step
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.start_coaching_from_request((select id from r1)) $$, 'the coach starts coaching, deliberately');
select is(public.is_active_coach_of('c8000000-0000-0000-0000-000000000002'), true, 'now the client is coached');
select throws_ok($$ select public.start_coaching_from_request((select id from r1)) $$, '55000', 'ALREADY_COACHED',
  'not twice');
select is((select started from public.coach_requests() where id = (select id from r1)), true, 'the request shows it started');
reset role;
select is((select status from public.coaching_requests where coach_id = 'c8000000-0000-0000-0000-000000000003'), 'closed',
  'the client''s other pending request is closed once they have a coach');

-- ============================================================================
-- 4. decline, cancel, contact again
-- ============================================================================
-- Sam asks Max; Max declines; Sam may ask again
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000004');
create temp table r2 as select public.request_coaching(pg_temp.pid('max-contact'), null, 'Hello') as id;
grant select on r2 to authenticated;
reset role;
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.decline_coaching_request((select id from r2)) $$, 'the coach declines');
reset role;
select is((select status from public.coaching_requests where id = (select id from r2)), 'declined', 'pending → declined');
select is(pg_temp.notices('c8000000-0000-0000-0000-000000000004', 'declined'), 1, 'the client is told');
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000004');
select is(public.coach_viewer_state(pg_temp.pid('max-contact')) #>> '{last_request,status}', 'declined',
  'the profile''s CTA offers to contact again');
create temp table r3 as select public.request_coaching(pg_temp.pid('max-contact'), null, 'Trying again') as id;
select is((select status from public.coaching_requests where id = (select id from r3)), 'pending', 'a declined request does not block a new one');
select lives_ok($$ select public.cancel_coaching_request((select id from r3)) $$, 'the client cancels it');
select is((select status from public.coaching_requests where id = (select id from r3)), 'cancelled', 'pending → cancelled');
select lives_ok($$ select public.request_coaching(pg_temp.pid('max-contact'), null, 'Third time') $$,
  'a cancelled request does not block a new one either');
reset role;
select is(pg_temp.notices('c8000000-0000-0000-0000-000000000003', 'cancelled'), 1, 'the coach is told of the cancellation');

-- ============================================================================
-- 5. blocks: no notice across one
-- ============================================================================
insert into public.social_user_blocks (blocker_id, blocked_id)
values ('c8000000-0000-0000-0000-000000000003', 'c8000000-0000-0000-0000-000000000004');
select pg_temp.authenticate_as('c8000000-0000-0000-0000-000000000004');
select lives_ok($$ select public.cancel_coaching_request(
  (select id from public.coaching_requests where status = 'pending' and coach_id = 'c8000000-0000-0000-0000-000000000003')) $$,
  'a client can still take back their own request after a block');
reset role;
select is(pg_temp.notices('c8000000-0000-0000-0000-000000000003', 'cancelled'), 1,
  'but no notice crosses the block (still the one from before)');

select * from finish();
rollback;
