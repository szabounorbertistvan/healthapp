-- pgTAP · External calendar foundation (20261111130000)
--
-- Security: tokens are unreadable through the API — even by their owner;
-- busy time is unreadable too; a coach sees only their own connections and
-- calendars; every write is a function, the sync ones service_role only.
-- Behaviour: a connection is opened, synced (only calendars that affect
-- availability keep busy time), blocks the booking slots it overlaps
-- (buffers included, in absolute time), refuses a booking on a busy start,
-- survives a failed sync (busy time kept), and a disconnect frees the slots
-- at once and leaves the token only until it is revoked.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs calendar_integrations

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
create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$fn$;

-- 01 coach Kai (Bucharest) · 02 coach Mo · 03 client Cy
insert into auth.users (id, email, raw_user_meta_data) values
  ('cc000000-0000-0000-0000-000000000001'::uuid, 'kai@cal.local', '{"full_name":"Kai","username":"kai_cal"}'),
  ('cc000000-0000-0000-0000-000000000002'::uuid, 'mo@cal.local',  '{"full_name":"Mo","username":"mo_cal"}'),
  ('cc000000-0000-0000-0000-000000000003'::uuid, 'cy@cal.local',  '{"full_name":"Cy","username":"cy_cal"}');
update public.users set timezone = 'Europe/Bucharest' where id::text like 'cc000000-%';
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000002'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'K', online = true where slug = 'kai-cal';
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit, delivery)
select 'ccb00000-0000-0000-0000-000000000001'::uuid, cp.id, 'Call', 10000, 'session', 'online'
from public.coach_profiles cp where cp.slug = 'kai-cal';

-- D: three days ahead in the coach's zone, 09:00–13:00; 60-minute sessions, 15 minutes after
create temp table ctx as select ((now() at time zone 'Europe/Bucharest')::date + 3) as d;
grant select on ctx to authenticated, anon;
create or replace function pg_temp.at(p_time time, p_tz text default 'Europe/Bucharest') returns timestamptz language sql as $fn$
  select ((select d from ctx) + p_time) at time zone p_tz $fn$;
create or replace function pg_temp.slot_times() returns text language sql as $fn$
  select coalesce(string_agg(to_char(start_at at time zone 'Europe/Bucharest', 'HH24:MI'), ',' order by start_at), '')
  from public.coach_booking_slots('ccb00000-0000-0000-0000-000000000001', (select d from ctx), 1);
$fn$;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select public.coach_set_service_booking('ccb00000-0000-0000-0000-000000000001', true, 60, 0, 15, 60, 30, 'public', 'instant');
insert into public.coach_availability (coach_id, weekday, start_time, end_time)
select auth.uid(), extract(isodow from (select d from ctx))::int, '09:00', '13:00';
reset role;

select is(pg_temp.slot_times(), '09:00,09:30,10:00,10:30,11:00,11:30,12:00', 'before any calendar: every slot of the block');

-- ============================================================================
-- 1. opening a connection: the server's door only
-- ============================================================================
select ok(not has_function_privilege('authenticated', 'public.calendar_connection_open(uuid, text, text, text[])', 'execute')
          and not has_function_privilege('authenticated', 'public.calendar_sync_apply(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.calendar_sync_failed(uuid, text, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.calendar_connections_due(int)', 'execute')
          and not has_function_privilege('authenticated', 'public.calendar_credentials_revoked(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.calendar_sync_apply(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz)', 'execute'),
  'no app role may open, sync or fail a connection');
select ok(has_function_privilege('service_role', 'public.calendar_sync_apply(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.calendar_connection_open(uuid, text, text, text[])', 'execute'),
  'the server (service_role) may');
select throws_ok($$ select public.calendar_connection_open('cc000000-0000-0000-0000-000000000003', 'google', 'cy@x', '{}') $$,
  '42501', 'NOT_A_COACH', 'only a coach connects a calendar');
create temp table conn as select public.calendar_connection_open('cc000000-0000-0000-0000-000000000001', 'google', 'kai@gmail.test',
                                                                  array['https://www.googleapis.com/auth/calendar.freebusy']) as id;
grant select on conn to authenticated;
select is(public.calendar_connection_open('cc000000-0000-0000-0000-000000000001', 'google', 'kai@gmail.test', '{}'), (select id from conn),
  'reconnecting reuses the live connection');
select throws_ok($$ insert into public.calendar_connections (coach_id, provider) values ('cc000000-0000-0000-0000-000000000001', 'microsoft')
                    on conflict do nothing; insert into public.calendar_connections (coach_id, provider) values ('cc000000-0000-0000-0000-000000000001', 'google') $$,
  '23505', null, 'one live connection per coach and provider');
delete from public.calendar_connections where provider = 'microsoft';
insert into public.calendar_credentials (connection_id, access_token_enc, refresh_token_enc, access_token_expires_at)
select id, 'Y2lwaGVydGV4dA==', 'cmVmcmVzaA==', now() + interval '1 hour' from conn;

-- ============================================================================
-- 2. who reads what
-- ============================================================================
select pg_temp.anonymous();
select throws_ok($$ select count(*) from public.calendar_connections $$, '42501', null, 'anon reads no connection');
select throws_ok($$ select public.my_calendar_integrations() $$, '42501', null, 'anon has no integrations door');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.calendar_connections), 1, 'the coach reads their own connection');
select throws_ok($$ select access_token_enc from public.calendar_credentials $$, '42501', null, 'not even the owner reads a token');
select throws_ok($$ select * from public.calendar_connections $$, '42501', null, 'no select * on connections: only the status columns are granted');
select throws_ok($$ select count(*) from public.calendar_busy_blocks $$, '42501', null, 'busy time is not readable through the API');
select throws_ok($$ insert into public.calendar_connections (coach_id, provider) values (auth.uid(), 'microsoft') $$,
  '42501', null, 'a connection is not written directly');
select throws_ok($$ update public.calendar_connections set status = 'connected' $$, '42501', null, 'nor its status');
select is(public.my_calendar_integrations() -> 0 ->> 'status', 'pending', 'the coach sees the connection pending');
select ok(not (public.my_calendar_integrations() -> 0 ?| array['access_token_enc', 'refresh_token_enc', 'sync_state', 'scopes']),
  'no secret and no sync state in what the coach reads');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.calendar_connections), 0, 'another coach sees none of it');
select is(public.my_calendar_integrations(), '[]'::jsonb, 'and has no integrations');
reset role;

-- ============================================================================
-- 3. a sync: only calendars that affect availability keep busy time
-- ============================================================================
select is((select count(*)::int from public.calendar_connections_due(10)), 1, 'the new connection is due');
select is((select status from public.calendar_connections where id = (select id from conn)), 'syncing', 'and is taken (syncing)');
select throws_ok($$ select public.calendar_sync_apply((select id from conn), null, null, now(), now() - interval '1 day') $$,
  '22023', 'INVALID_WINDOW', 'a backwards window is refused');
select is(public.calendar_sync_apply((select id from conn),
  '[{"id":"primary","name":"Work","primary":true},{"id":"family","name":"Family","primary":false}]'::jsonb,
  jsonb_build_array(
    jsonb_build_object('calendar', 'primary', 'start', pg_temp.at('10:00'), 'end', pg_temp.at('11:00')),
    jsonb_build_object('calendar', 'family', 'start', pg_temp.at('12:00'), 'end', pg_temp.at('13:00')),
    jsonb_build_object('calendar', 'unknown', 'start', pg_temp.at('09:00'), 'end', pg_temp.at('09:30'))),
  now() - interval '1 day', now() + interval '30 days', now() + interval '1 hour'), 1,
  'one busy block kept: the primary calendar''s (family is opt-in, unknown calendars ignored)');
select is((select status from public.calendar_connections where id = (select id from conn)), 'connected', 'connected after a sync');
create temp table src as select external_id as ext, id from public.calendar_sources;
grant select on src to authenticated;
select is(pg_temp.slot_times(), '11:00,11:30,12:00',
  'busy 10:00–11:00 removes 09:00–10:30 (60 minutes + 15 after) and leaves the family calendar''s noon');

select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.book_service('ccb00000-0000-0000-0000-000000000001', pg_temp.at('10:00')) $$,
  '23P01', 'SLOT_UNAVAILABLE', 'a client cannot book over the coach''s external busy time');
select lives_ok($$ select public.book_service('ccb00000-0000-0000-0000-000000000001', pg_temp.at('11:00')) $$,
  'a free slot still books');
reset role;

-- ============================================================================
-- 4. the coach's choices
-- ============================================================================
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.calendar_set_source_availability((select id from src where ext = 'family'), true) $$,
  'P0002', 'NOT_FOUND', 'another coach cannot touch Kai''s calendars');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.calendar_sources), 2, 'the coach lists their calendars');
select lives_ok($$ select public.calendar_set_source_availability((select id from src where ext = 'family'), true) $$,
  'turning the family calendar on');
reset role;
select ok((select next_sync_at <= now() from public.calendar_connections where id = (select id from conn)), '… asks for a sync now');
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.calendar_set_source_availability((select id from src where ext = 'primary'), false) $$,
  'turning the work calendar off');
reset role;
select is((select count(*)::int from public.calendar_busy_blocks), 0, '… drops its busy time at once');
select is(pg_temp.slot_times(), '09:00,09:30', 'and its slots come back (10:00 onwards now meets Cy''s 11:00 booking)');

-- ============================================================================
-- 5. failures keep busy time; credentials refused = reconnect
-- ============================================================================
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select public.calendar_set_source_availability((select id from src where ext = 'primary'), true);
reset role;
select public.calendar_sync_apply((select id from conn), null,
  jsonb_build_array(jsonb_build_object('calendar', 'primary', 'start', pg_temp.at('09:00'), 'end', pg_temp.at('09:30'))),
  now() - interval '1 day', now() + interval '30 days');
select public.calendar_sync_failed((select id from conn), 'provider_unavailable');
select is((select status || ':' || last_error_code from public.calendar_connections where id = (select id from conn)),
  'error:provider_unavailable', 'an outage is an error, retried later');
select is(pg_temp.slot_times(), '09:30', 'busy time synced before the outage still blocks (09:00–09:30 busy)');
select public.calendar_sync_failed((select id from conn), 'token_revoked');
select is((select status || ':' || coalesce(next_sync_at::text, 'none') from public.calendar_connections where id = (select id from conn)),
  'reauth_required:none', 'refused credentials: reconnect required, no retry');
select public.calendar_sync_failed((select id from conn), 'something odd');
select is((select last_error_code from public.calendar_connections where id = (select id from conn)), 'unknown', 'an unknown code is stored as unknown');

-- ============================================================================
-- 6. disconnect
-- ============================================================================
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.calendar_disconnect((select id from conn)) $$, 'P0002', 'NOT_FOUND', 'only the owner disconnects');
reset role;
select pg_temp.authenticate_as('cc000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.calendar_disconnect((select id from conn)) $$, 'the coach disconnects');
select is(public.my_calendar_integrations(), '[]'::jsonb, 'nothing connected any more');
reset role;
select is((select count(*)::int from public.calendar_sources) + (select count(*)::int from public.calendar_busy_blocks), 0,
  'calendars and busy time are gone at once');
select is(pg_temp.slot_times(), '09:00,09:30', 'and the slots are free again');
select is((select revoke_pending from public.calendar_connections where id = (select id from conn)), true,
  'the token waits only to be revoked at the provider');
select public.calendar_credentials_revoked((select id from conn));
select is((select count(*)::int from public.calendar_credentials), 0, 'revoked: the token is deleted');

select * from finish();
rollback;
