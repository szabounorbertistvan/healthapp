-- pgTAP · An accepted request gets a conversation (20261104100000)
--
-- Accepted request != relationship, and messaging needs only the first: an
-- accepted request opens the pair's one conversation (on click, from either
-- side, no message sent); pending, declined and cancelled requests do not;
-- an active relationship still does. A block, a suspension, a pending
-- deletion or an ended relationship keeps the history and stops new
-- messages. Starting coaching reuses the conversation. A message notifies
-- the other side once per unread conversation; reading the thread reads it.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs request_conversations

begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- 01 coach K · 02 client C · 03 coach M · 04 stranger S · 05 client P · 06 client B · 07 client D · 08 client E
insert into auth.users (id, email, raw_user_meta_data) values
  ('c9000000-0000-0000-0000-000000000001'::uuid, 'kai@conv.local',  '{"full_name":"Kai","username":"kai_conv"}'),
  ('c9000000-0000-0000-0000-000000000002'::uuid, 'cleo@conv.local', '{"full_name":"Cleo","username":"cleo_conv"}'),
  ('c9000000-0000-0000-0000-000000000003'::uuid, 'max@conv.local',  '{"full_name":"Max","username":"max_conv"}'),
  ('c9000000-0000-0000-0000-000000000004'::uuid, 'sam@conv.local',  '{"full_name":"Sam","username":"sam_conv"}'),
  ('c9000000-0000-0000-0000-000000000005'::uuid, 'pia@conv.local',  '{"full_name":"Pia","username":"pia_conv"}'),
  ('c9000000-0000-0000-0000-000000000006'::uuid, 'bo@conv.local',   '{"full_name":"Bo","username":"bo_conv"}'),
  ('c9000000-0000-0000-0000-000000000007'::uuid, 'dan@conv.local',  '{"full_name":"Dan","username":"dan_conv"}'),
  ('c9000000-0000-0000-0000-000000000008'::uuid, 'eve@conv.local',  '{"full_name":"Eve","username":"eve_conv"}');

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000003'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'K', online = true
 where slug in ('kai-conv', 'max-conv');
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit)
select 'c9500000-0000-0000-0000-000000000001', id, 'Online coaching', 30000, 'month' from public.coach_profiles where slug = 'kai-conv';
create temp table ids as select slug, id from public.coach_profiles;
grant select on ids to authenticated;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$ select id from ids where slug = p_slug; $fn$;

-- requests and conversation ids, kept by name
create temp table req (name text primary key, id uuid);
create temp table conv (name text primary key, id uuid);
grant select, insert on req, conv to authenticated;
create or replace function pg_temp.r(p text) returns uuid language sql as $fn$ select id from req where name = p; $fn$;
create or replace function pg_temp.c(p text) returns uuid language sql as $fn$ select id from conv where name = p; $fn$;
create or replace function pg_temp.notices(p_user uuid, p_conv uuid, p_unread boolean default true) returns int
language sql security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = 'new_message' and payload ->> 'conversation_id' = p_conv::text
    and (not p_unread or read_at is null);
$fn$;
create or replace function pg_temp.pair_count(p_coach uuid, p_client uuid) returns int language sql security definer as $fn$
  select count(*)::int from public.conversations where coach_id = p_coach and client_id = p_client;
$fn$;

-- Cleo asks Kai (with a service), Pia asks Max, Pia asks Kai, Bo asks Kai, Dan asks Max
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000002');
insert into req values ('cleo-kai', public.request_coaching(pg_temp.pid('kai-conv'), 'c9500000-0000-0000-0000-000000000001',
  'Looking for strength coaching.', null, 'Deadlift 150 kg', 'online'));
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000005');
insert into req values ('pia-max', public.request_coaching(pg_temp.pid('max-conv'), null, 'Hi Max'));
insert into req values ('pia-kai', public.request_coaching(pg_temp.pid('kai-conv'), null, 'Hi Kai'));
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000006');
insert into req values ('bo-kai', public.request_coaching(pg_temp.pid('kai-conv'), null, 'Hi from Bo'));
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000007');
insert into req values ('dan-max', public.request_coaching(pg_temp.pid('max-conv'), null, 'Hi from Dan'));
reset role;

-- ============================================================================
-- 1. a pending request opens nothing
-- ============================================================================
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('cleo-kai')) $$,
  '55000', 'CONVERSATION_CLOSED', 'a pending request does not open a conversation (client)');
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('cleo-kai')) $$,
  '55000', 'CONVERSATION_CLOSED', 'nor for the coach');
select throws_ok($$ insert into public.conversations (coach_id, client_id) values (auth.uid(), 'c9000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a coach cannot open a conversation with someone who is not their client directly');
reset role;
select is(pg_temp.pair_count('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002'), 0,
  'no conversation exists for a pending request');

-- ============================================================================
-- 2. accepted: either side opens the one conversation, no message sent
-- ============================================================================
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.accept_coaching_request(pg_temp.r('cleo-kai')) $$, 'Kai accepts Cleo');
reset role;
select is(pg_temp.pair_count('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002'), 0,
  'accepting creates no conversation by itself');

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000002');
insert into conv values ('cleo-kai', public.open_request_conversation(pg_temp.r('cleo-kai')));
select isnt(pg_temp.c('cleo-kai'), null, 'the client opens the conversation from the accepted request');
select is(public.open_request_conversation(pg_temp.r('cleo-kai')), pg_temp.c('cleo-kai'), 'opening again returns the same one');
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select is(public.open_request_conversation(pg_temp.r('cleo-kai')), pg_temp.c('cleo-kai'), 'the coach gets the same conversation');
reset role;
select is(pg_temp.pair_count('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002'), 1,
  'exactly one conversation for the pair');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('cleo-kai')), 0,
  'opening sends nothing');

-- ============================================================================
-- 3. the conversation: messages both ways, notices, read state
-- ============================================================================
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('cleo-kai'), auth.uid(), 'Hi Kai!') $$,
  'the client writes first');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('cleo-kai'), auth.uid(), 'When can we talk?') $$,
  'and again');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('cleo-kai'), 'c9000000-0000-0000-0000-000000000001', 'forged') $$,
  '42501', null, 'nobody writes as the other side');
select is((select context ->> 'side' from (select public.conversation_context(pg_temp.c('cleo-kai')) as context) x), 'client',
  'the context says which side the reader is on');
select is(public.conversation_context(pg_temp.c('cleo-kai')) #>> '{request,service_name}', 'Online coaching',
  'and carries the request''s service');
select is(public.conversation_context(pg_temp.c('cleo-kai')) #>> '{request,message}', 'Looking for strength coaching.',
  'and its original message, so it is not written twice');
select is(public.conversation_context(pg_temp.c('cleo-kai')) ->> 'relationship', 'request', 'a request, not coaching yet');
select is((public.conversation_context(pg_temp.c('cleo-kai')) ->> 'open')::boolean, true, 'open for writing');
select throws_ok($$ update public.messages set body = 'rewritten' where conversation_id = pg_temp.c('cleo-kai') $$,
  '42501', null, 'a participant cannot rewrite a message body');
reset role;

select is(pg_temp.notices('c9000000-0000-0000-0000-000000000001', pg_temp.c('cleo-kai')), 1,
  'the coach gets one new_message notice for two messages');
select is((select payload ->> 'screen' from public.notifications where user_id = 'c9000000-0000-0000-0000-000000000001'
           and category = 'new_message' limit 1), 'coach_thread', 'which opens the coach''s thread');
select is((select body from public.notifications where user_id = 'c9000000-0000-0000-0000-000000000001'
           and category = 'new_message' limit 1), 'cleo_conv sent you a message', 'and carries no message text');

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select is((select unread from public.coach_conversations() where id = pg_temp.c('cleo-kai')), 2, 'the coach''s inbox shows 2 unread');
select is((select relationship from public.coach_conversations() where id = pg_temp.c('cleo-kai')), 'request', 'from an accepted request');
select is((select client_name from public.coach_conversations() where id = pg_temp.c('cleo-kai')), 'cleo_conv', 'with the client''s public name');
select is(public.mark_conversation_read(pg_temp.c('cleo-kai')), 2, 'reading the thread marks both read');
select is((select unread from public.coach_conversations() where id = pg_temp.c('cleo-kai')), 0, 'unread is back to 0');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('cleo-kai'), auth.uid(), 'Tomorrow at 6?') $$,
  'the coach replies');
reset role;
select is(pg_temp.notices('c9000000-0000-0000-0000-000000000001', pg_temp.c('cleo-kai')), 0, 'and the coach''s notice was read with it');
select is(pg_temp.notices('c9000000-0000-0000-0000-000000000002', pg_temp.c('cleo-kai')), 1, 'the client is notified of the reply');
select is((select payload ->> 'screen' from public.notifications where user_id = 'c9000000-0000-0000-0000-000000000002'
           and category = 'new_message' limit 1), 'client_thread', 'which opens the client''s thread');

-- messaging changes nothing about the request
select is((select status from public.coaching_requests where id = pg_temp.r('cleo-kai')), 'accepted', 'the request stays accepted');
select is((select count(*)::int from public.trainer_clients where coach_id = 'c9000000-0000-0000-0000-000000000001'
           and client_id = 'c9000000-0000-0000-0000-000000000002'), 0, 'and no relationship was created');
-- a second request to the same coach is allowed (gyms.test) — and is no second thread
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000002');
insert into req values ('cleo-kai-2', public.request_coaching(pg_temp.pid('kai-conv'), null, 'One more question'));
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.accept_coaching_request(pg_temp.r('cleo-kai-2')) $$, 'a second request, accepted too');
select is(public.open_request_conversation(pg_temp.r('cleo-kai-2')), pg_temp.c('cleo-kai'),
  'opens the same conversation: one per pair, never per request');
reset role;

-- ============================================================================
-- 4. an unrelated user sees nothing and opens nothing
-- ============================================================================
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('cleo-kai')) $$,
  'P0002', 'REQUEST_NOT_FOUND', 'a stranger cannot use someone else''s request');
select is((select count(*)::int from public.conversations where id = pg_temp.c('cleo-kai')), 0, 'cannot see the conversation');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('cleo-kai')), 0, 'nor its messages');
select is(public.conversation_context(pg_temp.c('cleo-kai')), null, 'nor its context');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('cleo-kai'), auth.uid(), 'hi') $$,
  '42501', null, 'nor write to it');
select is(public.mark_conversation_read(pg_temp.c('cleo-kai')), 0, 'nor mark it read');
select throws_ok($$ select public.conversation_pair_open('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'the pair check is internal');
reset role;

-- ============================================================================
-- 5. start coaching reuses the conversation
-- ============================================================================
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.start_coaching_from_request(pg_temp.r('cleo-kai')) $$, 'Kai starts coaching Cleo');
select is((select relationship from public.coach_conversations() where id = pg_temp.c('cleo-kai')), 'active', 'the thread is now coaching');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('cleo-kai'), auth.uid(), 'Welcome aboard') $$,
  'and keeps going');
reset role;
select is(pg_temp.pair_count('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002'), 1,
  'no duplicate conversation');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('cleo-kai')), 4, 'every message kept');

-- ============================================================================
-- 6. declined and cancelled requests
-- ============================================================================
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.decline_coaching_request(pg_temp.r('pia-max')) $$, 'Max declines Pia');
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('pia-max')) $$,
  '55000', 'CONVERSATION_CLOSED', 'a declined request opens no conversation');
reset role;

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.cancel_coaching_request(pg_temp.r('pia-kai')) $$, 'Pia cancels her pending request to Kai');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('pia-kai')) $$,
  '55000', 'CONVERSATION_CLOSED', 'a cancelled request opens no conversation');
reset role;
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('pia-kai')) $$,
  '55000', 'CONVERSATION_CLOSED', 'not for the coach either');
reset role;
select is(pg_temp.pair_count('c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000005')
        + pg_temp.pair_count('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000005'), 0,
  'no conversation for a declined or cancelled pair');

-- ============================================================================
-- 7. block, suspension, deletion
-- ============================================================================
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.accept_coaching_request(pg_temp.r('bo-kai')) $$, 'Kai accepts Bo');
insert into conv values ('bo-kai', public.open_request_conversation(pg_temp.r('bo-kai')));
reset role;
insert into public.social_user_blocks (blocker_id, blocked_id)
values ('c9000000-0000-0000-0000-000000000006', 'c9000000-0000-0000-0000-000000000001');
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000001');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('bo-kai'), auth.uid(), 'Hi Bo') $$,
  '42501', null, 'no message crosses a block');
select is((select count(*)::int from public.coach_conversations() where id = pg_temp.c('bo-kai')), 0,
  'and the thread leaves the coach''s inbox');
reset role;

select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.accept_coaching_request(pg_temp.r('dan-max')) $$, 'Max accepts Dan');
reset role;
update public.users set suspended_at = now() where id = 'c9000000-0000-0000-0000-000000000007';
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('dan-max')) $$,
  '55000', 'CONVERSATION_CLOSED', 'no conversation opens with a suspended account');
reset role;
update public.users set suspended_at = null where id = 'c9000000-0000-0000-0000-000000000007';
insert into public.account_deletion_requests (user_id) values ('c9000000-0000-0000-0000-000000000007');
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.open_request_conversation(pg_temp.r('dan-max')) $$,
  '55000', 'CONVERSATION_CLOSED', 'nor with an account being deleted');
reset role;

-- ============================================================================
-- 8. an active relationship permits messaging without any request; ended does not
-- ============================================================================
insert into public.trainer_clients (coach_id, client_id, status, started_at)
values ('c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000008', 'active', now());
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000003');
insert into public.conversations (coach_id, client_id) values (auth.uid(), 'c9000000-0000-0000-0000-000000000008');
reset role;
insert into conv select 'max-eve', id from public.conversations where coach_id = 'c9000000-0000-0000-0000-000000000003'
  and client_id = 'c9000000-0000-0000-0000-000000000008';
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000008');
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('max-eve'), auth.uid(), 'Hi coach') $$,
  'an active client writes to their coach');
reset role;
update public.trainer_clients set status = 'ended', ended_at = now()
 where coach_id = 'c9000000-0000-0000-0000-000000000003' and client_id = 'c9000000-0000-0000-0000-000000000008';
select pg_temp.authenticate_as('c9000000-0000-0000-0000-000000000008');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body) values (pg_temp.c('max-eve'), auth.uid(), 'Bye') $$,
  '42501', null, 'an ended relationship is history only');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.c('max-eve')), 1, 'which stays readable');
reset role;

select * from finish();
rollback;
