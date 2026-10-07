-- pgTAP · Coach availability, bookable services and bookings (20261105100000)
--
-- Weekly blocks (several a day, no overlap, no backwards interval, inactive
-- ones aside), time off (all day, timed, overlapping), slots computed from
-- them in the coach's zone (DST included), booking rules (service, coach,
-- access, notice, advance, the slot itself), double booking refused by the
-- database for the coach and for the client, the state moves and who may
-- make them, notices, reminders, and nobody seeing a booking that is not
-- theirs.
--
-- Every date is relative to today in the coach's zone, so the suite does not
-- age: D is three days ahead (past the 12 h default notice).
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_bookings

begin;
create extension if not exists pgtap with schema extensions;
select plan(100);

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

-- 01 coach K · 02 client C · 03 client P · 04 stranger S · 05 coach M · 06 A, K's active client
insert into auth.users (id, email, raw_user_meta_data) values
  ('ca000000-0000-0000-0000-000000000001'::uuid, 'kai@book.local',  '{"full_name":"Kai","username":"kai_book"}'),
  ('ca000000-0000-0000-0000-000000000002'::uuid, 'cleo@book.local', '{"full_name":"Cleo","username":"cleo_book"}'),
  ('ca000000-0000-0000-0000-000000000003'::uuid, 'pia@book.local',  '{"full_name":"Pia","username":"pia_book"}'),
  ('ca000000-0000-0000-0000-000000000004'::uuid, 'sam@book.local',  '{"full_name":"Sam","username":"sam_book"}'),
  ('ca000000-0000-0000-0000-000000000005'::uuid, 'max@book.local',  '{"full_name":"Max","username":"max_book"}'),
  ('ca000000-0000-0000-0000-000000000006'::uuid, 'ada@book.local',  '{"full_name":"Ada","username":"ada_book"}');
update public.users set timezone = 'Europe/Bucharest'
 where id in ('ca000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000005');

select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000005'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'K', online = true
 where slug in ('kai-book', 'max-book');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('ca000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000006', 'active', now());

-- s1 PT (to be bookable), s2 a digital plan, s3 clients-only, s4 to be switched off, s5 Max's
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit, delivery)
select v.id::uuid, cp.id, v.name, v.price, v.unit, v.delivery
from (values
  ('cab00000-0000-0000-0000-000000000001', 'kai-book', 'Online PT', 15000, 'session', 'online'),
  ('cab00000-0000-0000-0000-000000000002', 'kai-book', 'Custom plan', 30000, 'package', 'digital'),
  ('cab00000-0000-0000-0000-000000000003', 'kai-book', 'Client check', null, 'free', 'online'),
  ('cab00000-0000-0000-0000-000000000004', 'kai-book', 'Old offer', 10000, 'session', 'online'),
  ('cab00000-0000-0000-0000-000000000005', 'max-book', 'Max PT', 20000, 'session', 'in_person')
) v(id, slug, name, price, unit, delivery)
join public.coach_profiles cp on cp.slug = v.slug;

-- D: three days ahead in the coach's zone; WD its ISO weekday
create temp table ctx as
  select ((now() at time zone 'Europe/Bucharest')::date + 3) as d,
         extract(isodow from ((now() at time zone 'Europe/Bucharest')::date + 3))::int as wd;
create temp table b (name text primary key, id uuid);
grant select on ctx to authenticated, anon;
grant select, insert on b to authenticated;
create or replace function pg_temp.d() returns date language sql as $fn$ select d from ctx $fn$;
create or replace function pg_temp.wd() returns int language sql as $fn$ select wd from ctx $fn$;
create or replace function pg_temp.at(p_time time, p_tz text default 'Europe/Bucharest', p_day date default null)
returns timestamptz language sql as $fn$ select (coalesce(p_day, (select d from ctx)) + p_time) at time zone p_tz $fn$;
create or replace function pg_temp.bid(p text) returns uuid language sql as $fn$ select id from b where name = p $fn$;
create or replace function pg_temp.slots(p_service text, p_day date default null) returns int language sql as $fn$
  select count(*)::int from public.coach_booking_slots(p_service::uuid, coalesce(p_day, (select d from ctx)), 1);
$fn$;
create or replace function pg_temp.notices(p_user uuid, p_event text) returns int language sql security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = 'booking' and payload ->> 'event' = p_event;
$fn$;
create or replace function pg_temp.status(p text) returns text language sql security definer as $fn$
  select status from public.bookings where id = (select id from b where name = p);
$fn$;

-- ============================================================================
-- 1. service booking settings
-- ============================================================================
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000001', true, 60, 0, 15, 720, 60, 'public', 'approval') $$,
  'the coach makes a service bookable: 60 min, 15 min after, on approval');
select throws_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000002', true, 60) $$,
  '22023', 'NOT_BOOKABLE_KIND', 'a digital service (a plan) is never bookable');
select throws_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000004', true, null) $$,
  '22023', 'INVALID_BOOKING_SETTINGS', 'bookable needs a duration');
select throws_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000004', true, 5) $$,
  '22023', 'INVALID_BOOKING_SETTINGS', 'a 5-minute session is refused');
select lives_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000003', true, 30, 0, 0, 720, 60, 'clients', 'instant') $$,
  'a clients-only service, confirmed instantly');
select lives_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000004', true, 60) $$, 'and one more');
select throws_ok($$ update public.coach_services set bookable = true where id = 'cab00000-0000-0000-0000-000000000002' $$,
  '42501', null, 'the settings are not writable directly');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000001', false) $$,
  'P0002', 'NOT_FOUND', 'nobody else changes a coach''s booking settings');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000005', true, 60, 0, 0, 720, 60, 'public', 'instant') $$,
  'Max opens his');
insert into public.coach_availability (coach_id, weekday, start_time, end_time)
select auth.uid(), pg_temp.wd(), '09:00', '13:00';
reset role;

-- ============================================================================
-- 2. weekly availability
-- ============================================================================
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select lives_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                   values (auth.uid(), pg_temp.wd(), '09:00', '13:00') $$, 'a morning block');
select lives_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                   values (auth.uid(), pg_temp.wd(), '15:00', '19:00') $$, 'a second block the same day');
select lives_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                   values (auth.uid(), 7, '10:00', '12:00') $$, 'a Sunday block');
select throws_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                    values (auth.uid(), pg_temp.wd(), '12:00', '14:00') $$,
  '23P01', null, 'an overlapping block is refused');
select throws_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                    values (auth.uid(), pg_temp.wd(), '14:00', '13:00') $$,
  '23514', null, 'an end before the start is refused');
select throws_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                    values (auth.uid(), 8, '09:00', '10:00') $$,
  '23514', null, 'there is no eighth weekday');
select lives_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time, active)
                   values (auth.uid(), pg_temp.wd(), '10:00', '11:00', false) $$,
  'an inactive block may overlap');
select throws_ok($$ update public.coach_availability set active = true where active = false $$,
  '23P01', null, 'but cannot be switched on over an active one');
select is((select count(*)::int from public.coach_availability where coach_id = auth.uid()), 4, 'the coach reads their own blocks');
reset role;

select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000004');
select throws_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                    values ('ca000000-0000-0000-0000-000000000001', 1, '06:00', '07:00') $$,
  '42501', null, 'nobody writes another coach''s availability');
select throws_ok($$ insert into public.coach_availability (coach_id, weekday, start_time, end_time)
                    values (auth.uid(), 1, '06:00', '07:00') $$,
  '42501', null, 'someone without a coach profile has no availability');
select is((select count(*)::int from public.coach_availability), 0, 'nor reads anyone''s');
reset role;
select pg_temp.anonymous();
select throws_ok($$ select * from public.coach_availability $$, '42501', null, 'the public never reads the table');
select throws_ok($$ select * from public.bookings $$, '42501', null, 'nor bookings');
reset role;

-- ============================================================================
-- 3. slots, time zone, DST
-- ============================================================================
select pg_temp.anonymous();
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 14,
  'anyone sees 14 one-hour starts on D (09:00–12:00 and 15:00–18:00, every 30 min)');
select is((select min(start_at) from public.coach_booking_slots('cab00000-0000-0000-0000-000000000001', pg_temp.d(), 1)),
  pg_temp.at('09:00'), 'the first is 09:00 in the coach''s zone');
select is((select max(end_at) from public.coach_booking_slots('cab00000-0000-0000-0000-000000000001', pg_temp.d(), 1)),
  pg_temp.at('19:00'), 'the last ends at 19:00, inside the block');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000003'), 0, 'a clients-only service shows nothing to the public');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000002'), 0, 'a non-bookable one neither');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000006');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000003'), 16, 'its client sees its 30-minute starts (every 15 min)');
reset role;

update public.users set timezone = 'Europe/London' where id = 'ca000000-0000-0000-0000-000000000001';
select pg_temp.anonymous();
select is((select min(start_at) from public.coach_booking_slots('cab00000-0000-0000-0000-000000000001', pg_temp.d(), 1)),
  pg_temp.at('09:00', 'Europe/London'), 'the same week in another zone: 09:00 London');
reset role;
update public.users set timezone = 'Mars/Olympus' where id = 'ca000000-0000-0000-0000-000000000001';
select pg_temp.anonymous();
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 0, 'an unknown zone offers nothing rather than guessing');
reset role;
update public.users set timezone = 'Europe/Bucharest' where id = 'ca000000-0000-0000-0000-000000000001';

-- DST: the next EU change (last Sunday of March / October) whose previous Sunday is still bookable
create temp table dst as
  select min(t) as t from (
    select (date_trunc('month', make_date(y, m, 1)) + interval '1 month - 1 day')::date
           - extract(dow from (date_trunc('month', make_date(y, m, 1)) + interval '1 month - 1 day'))::int as t
    from generate_series(extract(year from now())::int, extract(year from now())::int + 1) y, unnest(array[3, 10]) m
  ) x where t - 7 >= current_date + 2;
grant select on dst to anon;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000004', true, 60, 0, 0, 720, 365) $$,
  'a service bookable a year ahead');
reset role;
select pg_temp.anonymous();
select is((select (min(start_at) at time zone 'Europe/Bucharest')::time
           from public.coach_booking_slots('cab00000-0000-0000-0000-000000000004', (select t from dst), 1)),
  '10:00'::time, 'on the DST Sunday the first slot is still 10:00 wall-clock');
select isnt((select extract(hour from min(start_at) at time zone 'UTC')
             from public.coach_booking_slots('cab00000-0000-0000-0000-000000000004', (select t from dst), 1)),
  (select extract(hour from min(start_at) at time zone 'UTC')
   from public.coach_booking_slots('cab00000-0000-0000-0000-000000000004', (select t from dst) - 7, 1)),
  'while its UTC hour moved against the Sunday before');
reset role;

-- ============================================================================
-- 4. time off
-- ============================================================================
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
with x as (insert into public.coach_availability_exceptions (coach_id, start_date, end_date, title)
            values (auth.uid(), pg_temp.d(), pg_temp.d(), 'Holiday') returning id)
insert into b select 'off-day', id from x;
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 0, 'an all-day block empties D');
delete from public.coach_availability_exceptions where id = pg_temp.bid('off-day');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 14, 'removing it restores D');
select lives_ok($$ insert into public.coach_availability_exceptions (coach_id, start_date, end_date, all_day, start_time, end_time, title)
                   values (auth.uid(), pg_temp.d(), pg_temp.d(), false, '10:00', '11:00', 'Dentist') $$, 'a timed block');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 11, 'takes the three starts that overlap 10:00–11:00');
select lives_ok($$ insert into public.coach_availability_exceptions (coach_id, start_date, end_date, all_day, start_time, end_time)
                   values (auth.uid(), pg_temp.d(), pg_temp.d(), false, '10:30', '11:30') $$, 'an overlapping block is allowed');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 10, 'and the two simply add up');
select throws_ok($$ insert into public.coach_availability_exceptions (coach_id, start_date, end_date, all_day, start_time, end_time)
                    values (auth.uid(), pg_temp.d(), pg_temp.d() + 1, false, '10:00', '11:00') $$,
  '23514', null, 'a timed block is one day');
select throws_ok($$ insert into public.coach_availability_exceptions (coach_id, start_date, end_date)
                    values (auth.uid(), pg_temp.d(), pg_temp.d() - 1) $$,
  '23514', null, 'a range ends after it starts');
select lives_ok($$ insert into public.coach_availability_exceptions (coach_id, start_date, end_date, title)
                   values (auth.uid(), pg_temp.d() + 14, pg_temp.d() + 20, 'Vacation') $$, 'a week of vacation');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001', pg_temp.d() + 14), 0, 'covers its first day');
delete from public.coach_availability_exceptions where coach_id = auth.uid();
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.coach_availability_exceptions), 0, 'nobody else reads a coach''s time off');
reset role;

-- ============================================================================
-- 5. booking
-- ============================================================================
select pg_temp.anonymous();
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('10:00')) $$,
  '42501', null, 'an anonymous visitor cannot book');
reset role;

select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-0000000000ff', pg_temp.at('10:00')) $$,
  'P0002', 'SERVICE_NOT_FOUND', 'an unknown service');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000002', pg_temp.at('10:00')) $$,
  '22023', 'NOT_BOOKABLE', 'a service that is not bookable');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000003', pg_temp.at('15:00')) $$,
  '42501', 'CLIENTS_ONLY', 'a clients-only service for someone who is not a client');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('14:00')) $$,
  '23P01', 'SLOT_UNAVAILABLE', 'a time outside the coach''s blocks');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('09:10')) $$,
  '23P01', 'SLOT_UNAVAILABLE', 'a start that is not one of the slots');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('09:00:30')) $$,
  '22023', 'INVALID_START', 'a start with seconds');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('10:00', 'Europe/Bucharest', pg_temp.d() + 100)) $$,
  '22023', 'TOO_FAR', 'beyond the advance window');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', date_trunc('minute', now() + interval '1 hour')) $$,
  '22023', 'TOO_SOON', 'inside the minimum notice');
select throws_ok($$ insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end)
                    values (auth.uid(), 'ca000000-0000-0000-0000-000000000001', 'x', now() + interval '3 days',
                            now() + interval '3 days 1 hour', 'UTC', now() + interval '3 days', now() + interval '3 days 1 hour') $$,
  '42501', null, 'nobody writes bookings directly');
insert into b values ('cleo', public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('10:00'), 'First session'));
select is(pg_temp.status('cleo'), 'pending', 'a valid booking on an approval service is pending');
select is((select timezone from public.bookings where id = pg_temp.bid('cleo')), 'Europe/Bucharest', 'it keeps the coach''s zone');
select is((select price_cents from public.bookings where id = pg_temp.bid('cleo')), 15000, 'and the price, for information');
reset role;
select is(pg_temp.notices('ca000000-0000-0000-0000-000000000001', 'requested'), 1, 'the coach is told');
select is((select count(*)::int from public.conversations where coach_id = 'ca000000-0000-0000-0000-000000000001'
           and client_id = 'ca000000-0000-0000-0000-000000000002'), 0, 'a booking opens no conversation');

select pg_temp.anonymous();
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 9,
  'the pending booking and its 15-minute buffer take five starts (09:00–11:00)');
reset role;

-- double booking
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('10:00')) $$,
  '23P01', 'SLOT_UNAVAILABLE', 'the same slot cannot be booked twice');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('11:00')) $$,
  '23P01', 'SLOT_UNAVAILABLE', 'nor one that runs into the buffer');
reset role;
select throws_ok($$ insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
                    values ('ca000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001', 'x',
                            pg_temp.at('10:30'), pg_temp.at('11:30'), 'Europe/Bucharest', pg_temp.at('10:30'), pg_temp.at('11:30'), 'pending') $$,
  '23P01', null, 'the database itself refuses an overlapping row for the coach, whoever writes it');
select throws_ok($$ insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
                    values ('ca000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000005', 'x',
                            pg_temp.at('10:30'), pg_temp.at('11:30'), 'Europe/Bucharest', pg_temp.at('10:30'), pg_temp.at('11:30'), 'confirmed') $$,
  '23P01', null, 'and an overlapping row for the client, even with another coach');
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000005', pg_temp.at('10:00')) $$,
  '23P01', 'SLOT_UNAVAILABLE', 'a client cannot book two coaches at once');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000005'), 4,
  'and Max''s slots that clash with the client''s own booking are not offered to them');
reset role;

select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('15:00')) $$,
  '22023', 'CANNOT_BOOK_SELF', 'a coach cannot book themselves');
reset role;

-- min notice raised past D
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select public.coach_set_service_booking('cab00000-0000-0000-0000-000000000004', true, 60, 0, 0, 43200, 60);
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000004', pg_temp.at('15:00')) $$,
  '22023', 'TOO_SOON', 'a 30-day notice refuses D');
reset role;
-- an inactive service
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select public.coach_set_service_active('cab00000-0000-0000-0000-000000000004', false);
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.book_service('cab00000-0000-0000-0000-000000000004', pg_temp.at('15:00')) $$,
  'P0002', 'SERVICE_NOT_FOUND', 'an inactive service is not bookable');
reset role;

-- ============================================================================
-- 6. who sees what
-- ============================================================================
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.bookings), 0, 'a stranger sees no booking');
select is((select count(*)::int from public.my_bookings()), 0, 'nor through the reads');
select is((select count(*)::int from public.coach_bookings('all')), 0, 'nor as a coach');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.bookings), 0, 'another coach sees none of Kai''s');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.my_bookings()), 1, 'the client sees their own');
select throws_ok($$ update public.bookings set status = 'confirmed' where id = pg_temp.bid('cleo') $$,
  '42501', null, 'and cannot confirm it themselves');
select throws_ok($$ select public.respond_booking(pg_temp.bid('cleo'), true) $$,
  '55000', 'BOOKING_NOT_PENDING', 'nor through the coach''s move');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.cancel_booking(pg_temp.bid('cleo')) $$,
  '55000', 'BOOKING_NOT_CANCELLABLE', 'a stranger cannot cancel it');
reset role;

-- ============================================================================
-- 7. the moves
-- ============================================================================
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.coach_bookings('pending')), 1, 'the coach sees it under Pending');
select is(public.respond_booking(pg_temp.bid('cleo'), true), 'confirmed', 'the coach confirms');
select throws_ok($$ select public.mark_booking(pg_temp.bid('cleo'), 'completed') $$,
  '55000', 'BOOKING_NOT_MARKABLE', 'a session that has not happened cannot be completed');
reset role;
select is(pg_temp.notices('ca000000-0000-0000-0000-000000000002', 'confirmed'), 1, 'the client is told');
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.cancel_booking(pg_temp.bid('cleo'), 'Something came up') $$, 'the client cancels');
select is(pg_temp.status('cleo'), 'cancelled', 'confirmed → cancelled');
select is(pg_temp.slots('cab00000-0000-0000-0000-000000000001'), 14, 'and the slot is free again');
reset role;
select is(pg_temp.notices('ca000000-0000-0000-0000-000000000001', 'cancelled'), 1, 'the coach is told');

select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000003');
insert into b values ('pia', public.book_service('cab00000-0000-0000-0000-000000000001', pg_temp.at('10:00')));
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select is(public.respond_booking(pg_temp.bid('pia'), false, 'Fully booked that week'), 'declined', 'the coach declines');
reset role;
select is(pg_temp.notices('ca000000-0000-0000-0000-000000000003', 'declined'), 1, 'the client is told');

select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000006');
insert into b values ('ada', public.book_service('cab00000-0000-0000-0000-000000000003', pg_temp.at('15:00')));
select is(pg_temp.status('ada'), 'confirmed', 'an instant service books straight to confirmed for a client');
reset role;
select is(pg_temp.notices('ca000000-0000-0000-0000-000000000001', 'booked'), 1, 'and the coach is told it is booked');

-- sessions that already happened
with x as (
  insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status, confirmed_at)
  values ('ca000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001', 'Online PT',
          now() - interval '3 hours', now() - interval '2 hours', 'Europe/Bucharest', now() - interval '3 hours', now() - interval '2 hours', 'confirmed', now() - interval '2 days')
  returning id)
insert into b select 'past-1', id from x;
with x as (
  insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status, confirmed_at)
  values ('ca000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001', 'Online PT',
          now() - interval '27 hours', now() - interval '26 hours', 'Europe/Bucharest', now() - interval '27 hours', now() - interval '26 hours', 'confirmed', now() - interval '3 days')
  returning id)
insert into b select 'past-2', id from x;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.cancel_booking(pg_temp.bid('past-1')) $$,
  '55000', 'BOOKING_NOT_CANCELLABLE', 'a session that started cannot be cancelled');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.coach_bookings('past')), 2, 'the coach sees the two waiting for an outcome');
select lives_ok($$ select public.mark_booking(pg_temp.bid('past-1'), 'completed') $$, 'one completed');
select lives_ok($$ select public.mark_booking(pg_temp.bid('past-2'), 'no_show') $$, 'one no-show');
select throws_ok($$ select public.mark_booking(pg_temp.bid('past-1'), 'cancelled') $$,
  '22023', 'INVALID_OUTCOME', 'an outcome is completed or no_show');
select is((select count(*)::int from public.coach_bookings('completed')), 2, 'both are under Completed');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.mark_booking(pg_temp.bid('past-1'), 'no_show') $$,
  '55000', 'BOOKING_NOT_MARKABLE', 'a client cannot record the outcome');
reset role;

-- ============================================================================
-- 8. reminders
-- ============================================================================
insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status, confirmed_at)
values ('ca000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000001', 'Online PT',
        now() + interval '5 hours', now() + interval '6 hours', 'Europe/Bucharest', now() + interval '5 hours', now() + interval '6 hours',
        'confirmed', now() - interval '2 days');
select is(public.detect_booking_reminders(), 1, 'a session within a day is reminded');
select is(pg_temp.notices('ca000000-0000-0000-0000-000000000003', 'reminder')
        + pg_temp.notices('ca000000-0000-0000-0000-000000000001', 'reminder'), 2, 'both sides, once');
select is(public.detect_booking_reminders(), 0, 'and never twice');

select * from finish();
rollback;
