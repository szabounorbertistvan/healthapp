-- pgTAP · Marketplace analytics v2 (20261111120000)
--
-- The five new browser events: search and filter_applied (directory, never
-- the query text), service_view, share and login_required (a profile). The
-- detail word is from a closed list or the call is refused; the old rules
-- still hold (bots, your own page, a hidden coach, once a day); the coach's
-- card and the admin's funnel count them; nobody reads the log directly.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs marketplace_analytics_v2

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
create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$fn$;
create or replace function pg_temp.browser(p_ip text, p_ua text default 'Mozilla/5.0 (Windows NT 10.0) Chrome/130')
returns void language plpgsql as $fn$
begin
  perform set_config('request.headers',
    case when p_ua is null then json_build_object('cf-connecting-ip', p_ip)::text
         else json_build_object('cf-connecting-ip', p_ip, 'user-agent', p_ua)::text end, true);
end;
$fn$;
create or replace function pg_temp.events(p_event text, p_detail text default null) returns int language sql security definer as $fn$
  select count(*)::int from public.marketplace_events where event = p_event and (p_detail is null or detail = p_detail);
$fn$;

-- 01 coach Ana (published) · 02 coach Bo (draft) · 03 admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('af000000-0000-0000-0000-000000000001'::uuid, 'ana@mk2.local', '{"full_name":"Ana","username":"ana_mk2"}'),
  ('af000000-0000-0000-0000-000000000002'::uuid, 'bo@mk2.local',  '{"full_name":"Bo","username":"bo_mk2"}'),
  ('af000000-0000-0000-0000-000000000003'::uuid, 'adm@mk2.local', '{"full_name":"Adm","username":"adm_mk2"}');
update public.users set role = 'admin' where id = 'af000000-0000-0000-0000-000000000003';
select pg_temp.authenticate_as('af000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('af000000-0000-0000-0000-000000000002'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'A' where slug = 'ana-mk2';

select pg_temp.anonymous();
select pg_temp.browser('203.0.113.70');
select ok(public.marketplace_track('search', p_city => 'cluj-napoca'), 'a search is counted (with its city context)');
select throws_ok($$ select count(*) from public.marketplace_events $$, '42501', null, 'the log is not readable by anon');
select ok(public.marketplace_track('filter_applied', p_detail => 'rating'), 'a filter is counted by name');
select throws_ok($$ select public.marketplace_track('filter_applied', p_detail => 'value=4.5') $$, '22023', 'UNKNOWN_DETAIL',
  'a filter outside the closed list is refused');
select throws_ok($$ select public.marketplace_track('filter_applied') $$, '22023', 'UNKNOWN_DETAIL', 'a filter needs its name');
select ok(public.marketplace_track('service_view', 'ana-mk2'), 'a service view on a public coach');
select ok(public.marketplace_track('share', 'ana-mk2', p_detail => 'native'), 'a share');
select ok(public.marketplace_track('login_required', 'ana-mk2', p_detail => 'book'), 'a sign-in wall on a profile');
select ok(not public.marketplace_track('login_required', 'ana-mk2', p_detail => 'book'), 'once a day per visitor, target and detail');
select ok(public.marketplace_track('login_required', 'ana-mk2', p_detail => 'contact'), 'another detail is another event');
select ok(not public.marketplace_track('service_view', 'bo-mk2'), 'a draft coach is not measured');
select throws_ok($$ select public.marketplace_track('coach_search') $$, '22023', 'UNKNOWN_EVENT', 'the event list is closed');
select pg_temp.browser('203.0.113.71', 'facebookexternalhit/1.1');
select ok(not public.marketplace_track('share', 'ana-mk2', p_detail => 'copy'), 'a link preview bot is not a visitor');
reset role;

select is(pg_temp.events('search'), 1, 'stored: the search');
select is((select count(*)::int from public.marketplace_events where event = 'search' and detail is not null), 0,
  'a search stores no detail — never the typed text');
select is(pg_temp.events('filter_applied', 'rating'), 1, 'stored: the filter name');
select is(pg_temp.events('login_required'), 2, 'stored: two walls');

select pg_temp.authenticate_as('af000000-0000-0000-0000-000000000001');
select pg_temp.browser('203.0.113.72');
select ok(not public.marketplace_track('share', 'ana-mk2', p_detail => 'copy'), 'sharing your own page is not counted');
select is((public.coach_marketplace_analytics(30) ->> 'service_views')::int, 1, 'the coach sees service views');
select is((public.coach_marketplace_analytics(30) ->> 'login_walls')::int, 2, '… and sign-in walls on their page');
reset role;

select pg_temp.authenticate_as('af000000-0000-0000-0000-000000000003');
select is((public.admin_marketplace_analytics(12) -> 'funnel' ->> 'login_required')::int, 2, 'the admin funnel has the new steps');
select is(public.admin_marketplace_analytics(12) -> 'filters', '[{"n": 1, "filter": "rating"}]'::jsonb, 'and which filters people use');
reset role;

select * from finish();
rollback;
