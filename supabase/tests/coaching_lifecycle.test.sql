-- pgTAP · The coaching relationship lifecycle (20261109100000 + 20261109110000)
--
-- invited → active → (paused ⇄ active) → ended, ended final. Only the two
-- participants move a relationship, only through coaching_transition();
-- nobody writes trainer_clients directly or changes who it is between. One
-- current (active or paused) coach per client, enforced by the database.
-- Every move leaves an event; the other side is told. Pausing keeps messages
-- open and bookings untouched; ending keeps the conversation (read-only), the
-- bookings and the review eligibility; a new engagement is a new row.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coaching_lifecycle

begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- 01 coach K · 02 client C · 03 coach M · 04 stranger S · 05 client D
insert into auth.users (id, email, raw_user_meta_data) values
  ('cf000000-0000-0000-0000-000000000001'::uuid, 'kai@life.local', '{"full_name":"Kai","username":"kai_life"}'),
  ('cf000000-0000-0000-0000-000000000002'::uuid, 'cleo@life.local', '{"full_name":"Cleo","username":"cleo_life"}'),
  ('cf000000-0000-0000-0000-000000000003'::uuid, 'max@life.local', '{"full_name":"Max","username":"max_life"}'),
  ('cf000000-0000-0000-0000-000000000004'::uuid, 'sam@life.local', '{"full_name":"Sam","username":"sam_life"}'),
  ('cf000000-0000-0000-0000-000000000005'::uuid, 'dee@life.local', '{"full_name":"Dee","username":"dee_life"}');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000003'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'K', online = true, accepting_clients = true
 where slug in ('kai-life', 'max-life');
create temp table ids as select slug, id from public.coach_profiles;
create temp table rel (name text primary key, id uuid);
grant select on ids to authenticated;
grant select, insert on rel to authenticated;
create or replace function pg_temp.pid(p text) returns uuid language sql as $fn$ select id from ids where slug = p $fn$;
create or replace function pg_temp.rid(p text) returns uuid language sql as $fn$ select id from rel where name = p $fn$;
create or replace function pg_temp.status(p text) returns text language sql security definer as $fn$
  select status::text from public.trainer_clients where id = (select id from rel where name = p);
$fn$;
create or replace function pg_temp.notices(p_user uuid, p_event text) returns int language sql security definer as $fn$
  select count(*)::int from public.notifications where user_id = p_user and category::text = 'coaching' and payload ->> 'event' = p_event;
$fn$;
-- request → accept → start, as the coach would
create or replace function pg_temp.engage(p_client uuid, p_coach uuid, p_slug text) returns uuid language plpgsql as $fn$
declare v_req uuid; v_rel uuid;
begin
  perform pg_temp.authenticate_as(p_client);
  v_req := public.request_coaching(pg_temp.pid(p_slug), null, 'Hello');
  perform pg_temp.authenticate_as(p_coach);
  perform public.accept_coaching_request(v_req);
  v_rel := public.start_coaching_from_request(v_req);
  perform set_config('role', 'postgres', true);
  return v_rel;
end;
$fn$;

-- ============================================================================
-- 1. start
-- ============================================================================
insert into rel values ('r1', pg_temp.engage('cf000000-0000-0000-0000-000000000002', 'cf000000-0000-0000-0000-000000000001', 'kai-life'));
reset role;
select is(pg_temp.status('r1'), 'active', 'accepted request → start coaching → active');
select isnt((select started_at from public.trainer_clients where id = pg_temp.rid('r1')), null, 'with its start date');
select is((select count(*)::int from public.conversations where coach_id = 'cf000000-0000-0000-0000-000000000001'
           and client_id = 'cf000000-0000-0000-0000-000000000002'), 1, 'one conversation');
select is((select count(*)::int from public.coaching_relationship_events where relationship_id = pg_temp.rid('r1')), 1,
  'the start is the first event');
select is((select count(*)::int from public.notifications where user_id = 'cf000000-0000-0000-0000-000000000002'
           and category::text = 'coaching_request' and payload ->> 'event' = 'started'), 1, 'the client is told it started');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.start_coaching_from_request((select id from public.coaching_requests
                    where trainer_client_id = pg_temp.rid('r1'))) $$, '55000', 'ALREADY_COACHED', 'no second start from the same request');
reset role;

-- ============================================================================
-- 2. nobody writes the table or changes who it is between
-- ============================================================================
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.trainer_clients set status = 'ended' where id = pg_temp.rid('r1') $$, '42501', null,
  'the coach cannot update the row directly');
select throws_ok($$ insert into public.trainer_clients (coach_id, client_id, status, started_at)
                    values (auth.uid(), 'cf000000-0000-0000-0000-000000000004', 'active', now()) $$, '42501', null,
  'nor fabricate an active relationship');
reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select throws_ok($$ update public.trainer_clients set coach_id = 'cf000000-0000-0000-0000-000000000003', status = 'ended'
                    where id = pg_temp.rid('r1') $$, '42501', null, 'the client cannot point their row at another coach');
reset role;
select throws_ok($$ update public.trainer_clients set client_id = 'cf000000-0000-0000-0000-000000000004' where id = pg_temp.rid('r1') $$,
  '42501', 'RELATIONSHIP_IDENTITY_IMMUTABLE', 'and nobody, not even a privileged path, changes the client');
select throws_ok($$ update public.trainer_clients set coach_id = 'cf000000-0000-0000-0000-000000000003' where id = pg_temp.rid('r1') $$,
  '42501', 'RELATIONSHIP_IDENTITY_IMMUTABLE', 'or the coach');

-- ============================================================================
-- 3. pause
-- ============================================================================
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'paused') $$, 'P0002', 'RELATIONSHIP_NOT_FOUND',
  'a stranger cannot pause it');
reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'paused', 'torn ligament, left knee') $$,
  '22023', 'INVALID_REASON', 'a reason is a general code, never a free-text explanation');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'invited') $$, '22023', 'INVALID_TRANSITION',
  'there is no going back to invited');
select is(public.coaching_transition(pg_temp.rid('r1'), 'paused', 'vacation'), 'paused', 'the client pauses: vacation');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'paused') $$, '55000', 'INVALID_TRANSITION',
  'pausing twice is refused');
select is(public.coach_viewer_state(pg_temp.pid('kai-life')) #>> '{relationship,status}', 'paused',
  'the coach page reads the paused relationship');
select is((select status from public.my_coaching_relationships() where id = pg_temp.rid('r1')), 'paused', 'and so does the client''s list');
-- messaging stays open while paused
select lives_ok($$ insert into public.messages (conversation_id, sender_id, body)
                   select c.id, auth.uid(), 'See you after the holiday'
                   from public.conversations c where c.client_id = auth.uid() and c.coach_id = 'cf000000-0000-0000-0000-000000000001' $$,
  'messages still go through while paused');
reset role;
select is((select paused_by from public.trainer_clients where id = pg_temp.rid('r1')), 'cf000000-0000-0000-0000-000000000002'::uuid,
  'who paused it is kept');
select is(pg_temp.notices('cf000000-0000-0000-0000-000000000001', 'paused'), 1, 'the coach is told');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001');
select is(public.is_active_coach_of('cf000000-0000-0000-0000-000000000002'), false,
  'the coach''s access to the client''s training data pauses with the coaching');
select is((select status from public.coach_client_relationships('paused') where id = pg_temp.rid('r1')), 'paused',
  'the coach sees them under Paused');
reset role;

-- one current coach: a paused coach still counts
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
create temp table rq_m as select public.request_coaching(pg_temp.pid('max-life'), null, 'Hi Max') as id;
grant select on rq_m to authenticated;
reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.accept_coaching_request((select id from rq_m)) $$, 'another coach may accept a request (that is talking)');
select throws_ok($$ select public.start_coaching_from_request((select id from rq_m)) $$, '55000', 'ALREADY_HAS_COACH',
  'but not start coaching someone whose coaching is only paused');
reset role;
select throws_ok($$ insert into public.trainer_clients (coach_id, client_id, status, started_at)
                    values ('cf000000-0000-0000-0000-000000000003', 'cf000000-0000-0000-0000-000000000002', 'active', now()) $$,
  '23505', null, 'the database itself refuses a second current coach');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.request_coaching(pg_temp.pid('kai-life'), null, 'again') $$, '55000', 'ALREADY_COACHED',
  'a paused client does not send their own coach a new request');
reset role;

-- ============================================================================
-- 4. resume
-- ============================================================================
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001');
select is(public.coaching_transition(pg_temp.rid('r1'), 'active'), 'active', 'the coach resumes it');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'active') $$, '55000', 'INVALID_TRANSITION',
  'resuming something active is refused');
reset role;
select is((select paused_at from public.trainer_clients where id = pg_temp.rid('r1')), null, 'the pause is cleared on the row');
select is((select count(*)::int from public.coaching_relationship_events where relationship_id = pg_temp.rid('r1')), 3,
  'and kept in the history: start, pause, resume');
select is((select reason from public.coaching_relationship_events where relationship_id = pg_temp.rid('r1') and to_status = 'paused'),
  'vacation', 'with the pause''s reason code');
select is(pg_temp.notices('cf000000-0000-0000-0000-000000000002', 'resumed'), 1, 'the client is told');
select isnt((select started_at from public.trainer_clients where id = pg_temp.rid('r1')), null, 'the original start date stays');

-- ============================================================================
-- 5. end
-- ============================================================================
-- a session booked for next week, before the end
insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
values ('cf000000-0000-0000-0000-000000000002', 'cf000000-0000-0000-0000-000000000001', 'PT',
        now() + interval '7 days', now() + interval '7 days 1 hour', 'UTC', now() + interval '7 days', now() + interval '7 days 1 hour', 'confirmed');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'ended') $$, 'P0002', 'RELATIONSHIP_NOT_FOUND',
  'a stranger cannot end it');
reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000001');
select is(public.coaching_transition(pg_temp.rid('r1'), 'ended', 'goals_reached'), 'ended', 'the coach ends it: goals reached');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'ended') $$, '55000', 'INVALID_TRANSITION', 'ending twice is refused');
select throws_ok($$ select public.coaching_transition(pg_temp.rid('r1'), 'active') $$, '55000', 'INVALID_TRANSITION',
  'an ended relationship does not resume');
select is((select status from public.coach_client_relationships('past') where id = pg_temp.rid('r1')), 'ended', 'the coach sees it under Past');
select is((select count(*)::int from public.coach_client_relationships('current') where id = pg_temp.rid('r1')), 0, 'and not under Current');
reset role;
select throws_ok($$ update public.trainer_clients set status = 'active' where id = pg_temp.rid('r1') $$, '55000', 'INVALID_TRANSITION',
  'no path — not even a privileged one — revives an ended relationship');
select isnt((select ended_at from public.trainer_clients where id = pg_temp.rid('r1')), null, 'the end date is kept');
select is((select ended_by from public.trainer_clients where id = pg_temp.rid('r1')), 'cf000000-0000-0000-0000-000000000001'::uuid, 'and who ended it');
select is(pg_temp.notices('cf000000-0000-0000-0000-000000000002', 'ended'), 1, 'the client is told');
select is((select status from public.bookings where client_id = 'cf000000-0000-0000-0000-000000000002' and start_at > now()), 'confirmed',
  'a future booking is not cancelled behind anyone''s back');
select is((select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id
           where c.client_id = 'cf000000-0000-0000-0000-000000000002'), 1, 'the conversation keeps its messages');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body)
                    select c.id, auth.uid(), 'Bye' from public.conversations c where c.client_id = auth.uid() $$, '42501', null,
  'after the end the thread is read-only');
select is((select count(*)::int from public.coaching_relationship_history(pg_temp.rid('r1'))), 4, 'the client reads the whole history');
select is((select actor from public.coaching_relationship_history(pg_temp.rid('r1')) where to_status = 'paused'), 'me',
  'with who did what, from their side');
select is((public.my_coach_review_state(pg_temp.pid('kai-life')) ->> 'eligible')::boolean, true, 'an ended coaching can be reviewed');
select is(public.coach_viewer_state(pg_temp.pid('kai-life')) #>> '{relationship,status}', 'ended', 'the coach page reads it as ended');
reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.coaching_relationship_history(pg_temp.rid('r1'))), 0, 'a stranger reads none of it');
select is((select count(*)::int from public.coaching_relationship_events), 0, 'directly neither');
reset role;

-- ============================================================================
-- 6. a new engagement is a new row
-- ============================================================================
insert into rel values ('r2', pg_temp.engage('cf000000-0000-0000-0000-000000000002', 'cf000000-0000-0000-0000-000000000001', 'kai-life'));
reset role;
select isnt(pg_temp.rid('r2'), pg_temp.rid('r1'), 'coaching again with the same coach is a new relationship');
select is(pg_temp.status('r1'), 'ended', 'the old one stays ended, as history');
select is(pg_temp.status('r2'), 'active', 'the new one is active');
select is((select count(*)::int from public.conversations where client_id = 'cf000000-0000-0000-0000-000000000002'), 1,
  'the same conversation carries on');
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.my_coaching_relationships()), 2, 'the client sees the current one and the past one');
reset role;

-- the public page says nothing about whom a coach coaches, now or before
select set_config('role', 'anon', true);
select ok(position('cleo_life' in public.coach_public_profile('kai-life')::text) = 0,
  'the public coach page names no client, current or past');
reset role;

-- paused → ended, by the client
insert into rel values ('r3', pg_temp.engage('cf000000-0000-0000-0000-000000000005', 'cf000000-0000-0000-0000-000000000003', 'max-life'));
reset role;
select pg_temp.authenticate_as('cf000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.coaching_transition(pg_temp.rid('r3'), 'paused') $$, 'a pause with no reason at all');
select is(public.coaching_transition(pg_temp.rid('r3'), 'ended', 'schedule'), 'ended', 'paused → ended');
reset role;

select * from finish();
rollback;
