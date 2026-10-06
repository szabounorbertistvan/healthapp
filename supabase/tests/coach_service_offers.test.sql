-- pgTAP · Coach services / offers (20261031100000)
--
-- A coach creates, edits, deletes, switches and orders their own services; the
-- public page shows only active ones of a published coach, with delivery and
-- duration; the database refuses malformed offers and anyone else's hands.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_service_offers

begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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

-- 01 the coach · 02 another user · 03 an admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('c5000000-0000-0000-0000-000000000001'::uuid, 'sara@offers.local', '{"full_name":"Sara","username":"sara_offers"}'),
  ('c5000000-0000-0000-0000-000000000002'::uuid, 'mal@offers.local',  '{"full_name":"Mal","username":"mal_offers"}'),
  ('c5000000-0000-0000-0000-000000000003'::uuid, 'adm@offers.local',  '{"full_name":"Adm","username":"adm_offers"}');
update public.users set role = 'admin' where id = 'c5000000-0000-0000-0000-000000000003';
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/sara.jpg'
 where id = 'c5000000-0000-0000-0000-000000000001';

select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select public.become_coach();
update public.coach_profiles set headline = 'Strength coach', about = 'Lifting for life.', online = true
 where user_id = auth.uid();
select public.coach_set_specializations(array['strength'], 'strength');

-- ============================================================================
-- 1. create, with the new fields (as the app does: no id, the database makes one)
-- ============================================================================
select lives_ok($$ insert into public.coach_services
  (coach_profile_id, name, description, kind, delivery, price_cents, currency, price_unit, sort_order)
  select id, 'Online coaching', 'Weekly check-ins', 'online_coaching', 'online', 40000, 'RON', 'month', 0
  from public.coach_profiles where user_id = auth.uid() $$, 'a recurring monthly service');
select lives_ok($$ insert into public.coach_services
  (coach_profile_id, name, kind, delivery, duration_value, duration_unit, price_cents, currency, price_unit, sort_order)
  select id, 'PT session', 'personal_training', 'in_person', 60, 'minutes', 15000, 'RON', 'session', 1
  from public.coach_profiles where user_id = auth.uid() $$, 'a one-time session with a duration');
select lives_ok($$ insert into public.coach_services
  (coach_profile_id, name, kind, delivery, price_cents, price_unit, sort_order)
  select id, 'Intro call', 'consultation', 'online', null, 'free', 2
  from public.coach_profiles where user_id = auth.uid() $$, 'a free service needs no price');
select lives_ok($$ insert into public.coach_services
  (coach_profile_id, name, kind, delivery, duration_value, duration_unit, price_cents, currency, price_unit, sort_order)
  select id, '12-week plan', 'training_program', 'digital', 12, 'weeks', 9900, 'EUR', 'package', 3
  from public.coach_profiles where user_id = auth.uid() $$, 'a digital program, one-time, in EUR');
select lives_ok($$ insert into public.coach_services
  (coach_profile_id, name, kind, delivery, price_cents, price_unit, active, sort_order)
  select id, 'Old offer', 'training_nutrition', 'hybrid', 120000, 'year', false, 4
  from public.coach_profiles where user_id = auth.uid() $$, 'a yearly hybrid offer, inactive');
select is(public.coach_profile_missing(), '{}'::text[], 'a free service does not count as missing a price');
select throws_ok($$ insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit)
  select gen_random_uuid(), id, 'Chosen id', 100, 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '42501', null, 'the coach cannot choose a service id');
reset role;

-- the ids, by original name, for the steps below (and for the other user's attempts)
create temp table svc as
  select sv.name, sv.id from public.coach_services sv
  join public.coach_profiles cp on cp.id = sv.coach_profile_id where cp.slug = 'sara-offers';
create temp table prof as select id from public.coach_profiles where slug = 'sara-offers';
grant select on svc, prof to authenticated, anon;
create or replace function pg_temp.sid(p_name text) returns uuid language sql as $fn$
  select id from svc where name = p_name;
$fn$;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');

-- ============================================================================
-- 2. validation
-- ============================================================================
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
  select id, 'Bad', -100, 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a negative price is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
  select id, '   ', 100, 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a blank title is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, description, price_cents, price_unit)
  select id, 'Long', repeat('x', 1001), 100, 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a description over 1000 characters is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, currency, price_unit)
  select id, 'Coin', 100, 'BTC', 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'an unknown currency is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, currency, price_unit)
  select id, 'Lower', 100, 'ron', 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a malformed currency is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit)
  select id, 'Kind', 'massage', 100, 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'an unknown service type is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, delivery, price_cents, price_unit)
  select id, 'Mail', 'carrier_pigeon', 100, 'month' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'an unknown delivery method is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
  select id, 'Daily', 100, 'day' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'an unknown billing period is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
  select id, 'Free?', 5000, 'free' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a free service with a price is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, duration_value, price_cents, price_unit)
  select id, 'Half', 60, 100, 'session' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a duration needs its unit');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, duration_value, duration_unit, price_cents, price_unit)
  select id, 'Zero', 0, 'minutes', 100, 'session' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a zero duration is refused');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, price_unit, active)
  select id, 'Status', 100, 'month', null from public.coach_profiles where user_id = auth.uid() $$,
  '23502', null, 'a missing status is refused');

-- ============================================================================
-- 3. edit, delete and order in draft
-- ============================================================================
select lives_ok($$ update public.coach_services set name = 'Online coaching (3 months min.)', price_cents = 45000
  where id = pg_temp.sid('Online coaching') $$, 'the coach edits a service');
select is((select price_cents from public.coach_services where id = pg_temp.sid('Online coaching')), 45000, 'the edit is saved');
select lives_ok($$ select public.coach_reorder_services(array[
  pg_temp.sid('PT session'), pg_temp.sid('Online coaching'), pg_temp.sid('Intro call'),
  pg_temp.sid('12-week plan'), pg_temp.sid('Old offer')]) $$, 'the coach reorders');
select is((select string_agg(name, ',' order by sort_order) from public.coach_services
           where id in (pg_temp.sid('Online coaching'), pg_temp.sid('PT session'))),
  'PT session,Online coaching (3 months min.)', 'in the new order');
select throws_ok($$ select public.coach_reorder_services(array[pg_temp.sid('PT session')]) $$,
  '22023', 'BAD_ORDER', 'an order must list every one of the coach''s services');
select lives_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
  select id, 'Temp', 100, 'month' from public.coach_profiles where user_id = auth.uid() $$, 'one more, to delete');
select lives_ok($$ delete from public.coach_services where name = 'Temp' $$, 'the coach deletes a service');
select is((select count(*)::int from public.coach_services where name = 'Temp'), 0, 'it is gone');
select lives_ok($$ select public.coach_set_service_active(pg_temp.sid('Intro call'), false) $$,
  'a draft may switch any service off');
select lives_ok($$ select public.coach_set_service_active(pg_temp.sid('Intro call'), true) $$, 'and on again');
reset role;

-- ============================================================================
-- 4. nobody else touches them
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.coach_services where id = pg_temp.sid('Online coaching')), 0,
  'another user cannot read a draft''s services');
update public.coach_services set price_cents = 1 where id = pg_temp.sid('Online coaching');
delete from public.coach_services where id = pg_temp.sid('PT session');
select throws_ok($$ select public.coach_set_service_active(pg_temp.sid('Online coaching'), false) $$,
  'P0002', 'NOT_FOUND', 'nor switch it');
select throws_ok($$ select public.coach_reorder_services(array[pg_temp.sid('Online coaching')]) $$,
  'P0002', 'NO_COACH_PROFILE', 'nor reorder it');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
  values ((select id from prof), 'Injected', 1, 'month') $$,
  '42501', null, 'nor add one to someone else''s profile');
reset role;
select is((select price_cents from public.coach_services where id = pg_temp.sid('Online coaching')), 45000,
  'the other user''s update changed nothing');
select is((select count(*)::int from public.coach_services where id = pg_temp.sid('PT session')), 1,
  'and their delete removed nothing');
select pg_temp.anonymous();
select throws_ok($$ select count(*) from public.coach_services $$, '42501', null, 'anonymous callers cannot read the table');
reset role;

-- ============================================================================
-- 5. published: the public page shows only active services, with the new fields
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select is(public.submit_coach_for_review(), '{}'::text[], 'submitted');
reset role;
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.admin_set_coach_profile_status((select id from public.coach_profiles where slug = 'sara-offers'), 'published') $$,
  'the admin publishes');
reset role;
select pg_temp.anonymous();
select is((select string_agg(s ->> 'name', ',') from jsonb_array_elements(public.coach_public_profile('sara-offers') -> 'services') s),
  'PT session,Online coaching (3 months min.),Intro call,12-week plan', 'active services only, in the coach''s order');
select is((select s ->> 'delivery' || ' ' || (s ->> 'duration_value') || ' ' || (s ->> 'duration_unit')
           from jsonb_array_elements(public.coach_public_profile('sara-offers') -> 'services') s where s ->> 'name' = 'PT session'),
  'in_person 60 minutes', 'with delivery and duration');
select is((select s ->> 'price_unit' from jsonb_array_elements(public.coach_public_profile('sara-offers') -> 'services') s
           where s ->> 'name' = 'Intro call'), 'free', 'a free service says so');
reset role;

-- ============================================================================
-- 6. published: switch and order without a review; content stays locked
-- ============================================================================
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.coach_set_service_active(pg_temp.sid('12-week plan'), false) $$,
  'a published coach switches a service off without a review');
select lives_ok($$ select public.coach_reorder_services(array[
  pg_temp.sid('Online coaching'), pg_temp.sid('PT session'), pg_temp.sid('Intro call'),
  pg_temp.sid('12-week plan'), pg_temp.sid('Old offer')]) $$, 'and reorders');
update public.coach_services set name = 'Sneaky rename' where id = pg_temp.sid('Online coaching');
select lives_ok($$ select public.coach_set_service_active(pg_temp.sid('PT session'), false) $$, 'switch off another');
select lives_ok($$ select public.coach_set_service_active(pg_temp.sid('Intro call'), false) $$, 'and another');
select throws_ok($$ select public.coach_set_service_active(pg_temp.sid('Online coaching'), false) $$,
  '55000', 'LAST_ACTIVE_SERVICE', 'the last active service of a public profile cannot be switched off');
reset role;
select pg_temp.anonymous();
select is((select string_agg(s ->> 'name', ',') from jsonb_array_elements(public.coach_public_profile('sara-offers') -> 'services') s),
  'Online coaching (3 months min.)', 'the public page follows at once; the content edit did not go through');
reset role;
update public.coach_profiles set status = 'suspended', suspended_at = now(), suspension_reason = 'x' where slug = 'sara-offers';
select pg_temp.authenticate_as('c5000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.coach_set_service_active(pg_temp.sid('PT session'), true) $$,
  '55000', 'PROFILE_LOCKED', 'a suspended profile cannot change its services');
reset role;

select * from finish();
rollback;
