-- pgTAP · Marketplace analytics & conversion tracking (20261110120000)
--
-- Views and clicks come only through marketplace_track(): a closed event
-- list, a daily-rotating hashed visitor computed from the request headers
-- (never stored), one per visitor / event / target / day, 60 an hour, no
-- bots, not your own profile, not a coach the public cannot see. Signup
-- attribution rides the sign-up metadata; conversions are written by
-- triggers on the business tables, once each, carrying the attribution.
-- Nobody reads the raw events; the coach and the admin get aggregates.
-- Retention deletes old raw events and every past salt.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs marketplace_analytics

begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

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
-- the browser's request, as PostgREST would pass it
create or replace function pg_temp.browser(p_ip text, p_ua text default 'Mozilla/5.0 (Windows NT 10.0) Chrome/130')
returns void language plpgsql as $fn$
begin
  perform set_config('request.headers',
    case when p_ua is null then json_build_object('cf-connecting-ip', p_ip)::text
         else json_build_object('cf-connecting-ip', p_ip, 'user-agent', p_ua)::text end, true);
end;
$fn$;
create or replace function pg_temp.events(p_event text) returns int language sql security definer as $fn$
  select count(*)::int from public.marketplace_events where event = p_event;
$fn$;

-- 01 coach Mia (published) · 02 coach Dan (draft) · 03 Vic (a signed-in visitor) · 04 admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('ae000000-0000-0000-0000-000000000001'::uuid, 'mia@mkt.local', '{"full_name":"Mia","username":"mia_mkt"}'),
  ('ae000000-0000-0000-0000-000000000002'::uuid, 'dan@mkt.local', '{"full_name":"Dan","username":"dan_mkt"}'),
  ('ae000000-0000-0000-0000-000000000003'::uuid, 'vic@mkt.local', '{"full_name":"Vic","username":"vic_mkt"}'),
  ('ae000000-0000-0000-0000-000000000004'::uuid, 'adm@mkt.local', '{"full_name":"Adm","username":"adm_mkt"}');
update public.users set role = 'admin' where id = 'ae000000-0000-0000-0000-000000000004';
select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000002'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'Mia', online = true, accepting_clients = true
 where slug = 'mia-mkt';

-- ============================================================================
-- 1. a public profile view, anonymous
-- ============================================================================
select pg_temp.anonymous();
select pg_temp.browser('203.0.113.7');
select is(public.marketplace_track('profile_view', 'mia-mkt', 'Instagram!!', 'social', 'Spring 26'), true, 'an anonymous profile view is recorded');
select is(public.marketplace_track('profile_view', 'mia-mkt'), false, 'the same visitor again today is not counted twice');
select pg_temp.browser('198.51.100.9');
select is(public.marketplace_track('profile_view', 'mia-mkt'), true, 'another visitor is');
select pg_temp.browser('203.0.113.8', 'Googlebot/2.1 (+http://www.google.com/bot.html)');
select is(public.marketplace_track('profile_view', 'mia-mkt'), false, 'a crawler is not a visitor');
select pg_temp.browser('203.0.113.9', null);
select is(public.marketplace_track('profile_view', 'mia-mkt'), false, 'nor is a request with no user agent');
select pg_temp.browser('203.0.113.7');
select is(public.marketplace_track('profile_view', 'dan-mkt'), false, 'a coach the public cannot see is not counted');
select is(public.marketplace_track('profile_view', 'nobody-here'), false, 'nor an unknown slug');
select throws_ok($$ select public.marketplace_track('request_sent', 'mia-mkt') $$, '22023', 'UNKNOWN_EVENT',
  'a browser cannot claim a conversion');
select throws_ok($$ select * from public.marketplace_events $$, '42501', null, 'raw events are not readable');
select throws_ok($$ select * from public.marketplace_salts $$, '42501', null, 'nor is the salt');
reset role;
select is(pg_temp.events('profile_view'), 2, 'two views stored');
select ok((select bool_and(visitor ~ '^[0-9a-f]{32}$') from public.marketplace_events), 'the visitor is a 32-hex hash');
select ok((select bool_and(t::text not like '%203.0.113%' and t::text not like '%Mozilla%') from public.marketplace_events t),
  'no IP address and no user agent is stored');
select is((select source || '|' || medium || '|' || campaign from public.marketplace_events where source is not null), 'instagram|social|spring26',
  'the source is cleaned to a short token');
select ok(not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = 'marketplace_events' and column_name in ('user_id', 'ip', 'user_agent')),
  'the event table has no user, IP or agent column');
select ok((select bool_and(not signed_in) from public.marketplace_events), 'anonymous views are marked as such');

-- ============================================================================
-- 2. clicks, the directory, the signed-in visitor, your own page
-- ============================================================================
select pg_temp.anonymous();
select pg_temp.browser('203.0.113.7');
select is(public.marketplace_track('cta_contact', 'mia-mkt'), true, 'a Contact click');
select is(public.marketplace_track('signup_started', 'mia-mkt', 'instagram'), true, 'a sign-up started from the coach page');
select is(public.marketplace_track('directory_view', null, null, null, null, 'cluj-napoca', 'bodybuilding'), true, 'a city + specialization listing');
select is(public.marketplace_track('directory_view', null, null, null, null, 'atlantis', null), true, 'a listing with an unknown city…');
reset role;
select is((select count(*)::int from public.marketplace_events where event = 'directory_view' and city = 'cluj-napoca' and specialization = 'bodybuilding'), 1,
  'the listing keeps its city and specialization');
select is((select count(*)::int from public.marketplace_events where event = 'directory_view' and city is null), 1, '…keeps no made-up city');

select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000003');
select pg_temp.browser('192.0.2.44');
select is(public.marketplace_track('profile_view', 'mia-mkt'), true, 'a signed-in view is recorded');
reset role;
select is((select count(*)::int from public.marketplace_events where event = 'profile_view' and signed_in), 1, 'as signed in, with no user id');
select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000001');
select pg_temp.browser('192.0.2.45');
select is(public.marketplace_track('profile_view', 'mia-mkt'), false, 'a coach viewing their own page is not counted');
reset role;

-- the hourly cap: 60 events per visitor (70 distinct listings, so the dedupe key never stops them first)
create temp table combos as
  select row_number() over () as i, c.slug as city, s.slug as spec
  from (select slug from public.cities order by slug limit 10) c cross join (select slug from public.specializations order by slug limit 7) s;
grant select on combos to anon;
select pg_temp.anonymous();
select pg_temp.browser('203.0.113.200');
do $$
declare r record;
begin
  perform public.marketplace_track('directory_view', null, 'spam1');
  for r in select city, spec from combos loop
    perform public.marketplace_track('directory_view', null, null, null, null, r.city, r.spec);
  end loop;
end;
$$;
reset role;
select cmp_ok((select count(*)::int from public.marketplace_events e
                where e.visitor = (select visitor from public.marketplace_events where source = 'spam1')), '<=', 60,
  'one visitor cannot record more than 60 events an hour');

-- ============================================================================
-- 3. sign-up attribution
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('ae000000-0000-0000-0000-000000000005'::uuid, 'new@mkt.local',
   '{"full_name":"Nina","username":"nina_mkt","signup_ref":{"coach":"mia-mkt","source":"Instagram","medium":"social","campaign":"spring"}}'),
  ('ae000000-0000-0000-0000-000000000006'::uuid, 'plain@mkt.local', '{"full_name":"Pat","username":"pat_mkt"}'),
  ('ae000000-0000-0000-0000-000000000007'::uuid, 'odd@mkt.local', '{"full_name":"Odd","username":"odd_mkt","signup_ref":"<script>"}');
select is((select count(*)::int from public.users where id in ('ae000000-0000-0000-0000-000000000005', 'ae000000-0000-0000-0000-000000000006',
                                                               'ae000000-0000-0000-0000-000000000007')), 3,
  'every sign-up went through, a malformed reference included');
select is((select source from public.marketplace_signups where user_id = 'ae000000-0000-0000-0000-000000000005'), 'instagram',
  'the sign-up keeps where it came from');
select is((select cp.slug from public.marketplace_signups s join public.coach_profiles cp on cp.id = s.coach_profile_id
            where s.user_id = 'ae000000-0000-0000-0000-000000000005'), 'mia-mkt', 'and the coach page it started on');
select is((select count(*)::int from public.marketplace_events where event = 'signup_completed'
            and coach_profile_id = (select id from public.coach_profiles where slug = 'mia-mkt')), 1, 'a sign-up completed from the coach profile');
select is((select count(*)::int from public.marketplace_signups), 1, 'a sign-up with no reference stores nothing');

-- ============================================================================
-- 4. conversions: written by the business tables, once, attributed
-- ============================================================================
insert into public.coaching_requests (client_id, coach_id, message)
values ('ae000000-0000-0000-0000-000000000005', 'ae000000-0000-0000-0000-000000000001', 'Hi');
select is((select source from public.marketplace_events where event = 'request_sent'), 'instagram', 'a request is recorded with its source');
update public.coaching_requests set status = 'accepted', resolved_at = now() where client_id = 'ae000000-0000-0000-0000-000000000005';
update public.coaching_requests set message = 'Hi again' where client_id = 'ae000000-0000-0000-0000-000000000005';
select is(pg_temp.events('request_accepted'), 1, 'accepted once, whatever else changes');

insert into public.trainer_clients (coach_id, client_id, status, started_at)
values ('ae000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-000000000005', 'active', now() - interval '10 days');
update public.trainer_clients set status = 'paused' where client_id = 'ae000000-0000-0000-0000-000000000005';
update public.trainer_clients set status = 'active' where client_id = 'ae000000-0000-0000-0000-000000000005';
select is(pg_temp.events('coaching_started'), 1, 'coaching started once — a resume is not a start');

insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
values ('ae000000-0000-0000-0000-000000000005', 'ae000000-0000-0000-0000-000000000001', 'PT',
        now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'UTC',
        now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'confirmed');
update public.bookings set status = 'completed', resolved_at = now() where client_id = 'ae000000-0000-0000-0000-000000000005';
select is(pg_temp.events('booking_created'), 1, 'a booking created');
select is(pg_temp.events('booking_completed'), 1, 'and completed');

create temp table mia as select id from public.coach_profiles where slug = 'mia-mkt';
grant select on mia to authenticated;
select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.submit_coach_review((select id from mia), 5, 'Great') $$, 'the client reviews');
reset role;
select is(pg_temp.events('review_submitted'), 1, 'a review submitted');

insert into public.coach_saves (user_id, coach_profile_id)
select 'ae000000-0000-0000-0000-000000000003', id from public.coach_profiles where slug = 'mia-mkt';
delete from public.coach_saves where user_id = 'ae000000-0000-0000-0000-000000000003';
insert into public.coach_saves (user_id, coach_profile_id)
select 'ae000000-0000-0000-0000-000000000003', id from public.coach_profiles where slug = 'mia-mkt';
select is(pg_temp.events('coach_saved'), 1, 'a save toggled off and on counts once');

-- ============================================================================
-- 5. the coach's analytics, the admin's aggregate
-- ============================================================================
select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000001');
select is((public.coach_marketplace_analytics(30) ->> 'profile_views')::int, 3, 'the coach sees their profile views');
select is((public.coach_marketplace_analytics(30) ->> 'contact_clicks')::int, 1, 'their Contact clicks');
select is((public.coach_marketplace_analytics(30) ->> 'requests')::int, 1, 'their requests (from the requests table)');
select is((public.coach_marketplace_analytics(30) ->> 'bookings_completed')::int, 1, 'their completed bookings');
select is((public.coach_marketplace_analytics(30) ->> 'review_count')::int, 1, 'their review count');
select is((public.coach_marketplace_analytics(30) ->> 'signups')::int, 1, 'sign-ups their page brought');
select ok(public.coach_marketplace_analytics(30) -> 'sources' @> '[{"source":"instagram"}]', 'and where views came from');
reset role;
select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000003');
select is(public.coach_marketplace_analytics(30), null, 'a non-coach has no analytics');
select throws_ok($$ select public.admin_marketplace_analytics() $$, '42501', 'ADMIN_ONLY', 'the aggregate is admin-only');
reset role;
select pg_temp.authenticate_as('ae000000-0000-0000-0000-000000000004');
select is((public.admin_marketplace_analytics() -> 'last30' ->> 'profile_views')::int, 3, 'the admin sees profile views');
select is((public.admin_marketplace_analytics() -> 'last30' ->> 'signups_from_profile')::int, 1, 'sign-ups from coach profiles');
select is((public.admin_marketplace_analytics() -> 'funnel' ->> 'request_sent')::int, 1, 'the funnel');
select is((public.admin_marketplace_analytics() -> 'coaches' ->> 'public')::int, 1, 'the public coaches');
select is(jsonb_array_length(public.admin_marketplace_analytics(12) -> 'weekly'), 12, 'twelve weeks of trend');
reset role;

-- ============================================================================
-- 6. retention
-- ============================================================================
insert into public.marketplace_events (event, coach_profile_id, created_at, dedupe_key)
select 'profile_view', id, now() - interval '200 days', 'old-view' from public.coach_profiles where slug = 'mia-mkt';
insert into public.marketplace_events (event, coach_profile_id, created_at, dedupe_key)
select 'request_sent', id, now() - interval '200 days', 'old-request' from public.coach_profiles where slug = 'mia-mkt';
insert into public.marketplace_salts (day) values (current_date - 1);
select public.marketplace_retention();
select ok(not exists (select 1 from public.marketplace_events where dedupe_key = 'old-view')
          and exists (select 1 from public.marketplace_events where dedupe_key = 'old-request'),
  'raw views go after 180 days, conversions stay');
select ok(not exists (select 1 from public.marketplace_salts where day < current_date), 'past salts are deleted');

select * from finish();
rollback;
