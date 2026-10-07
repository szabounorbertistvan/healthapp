-- pgTAP · The marketplace's operational side (20261108100000)
--
-- Staged revisions: a published coach edits a copy; the public page does not
-- change until an admin approves; invalid copies are refused by the real
-- tables, incomplete ones cannot be submitted; reject keeps the live page and
-- tells the coach why; discard leaves no trace; nobody else touches a copy.
-- The overview counts only the caller's rows. Starting coaching tells the client.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_marketplace_ops

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

-- 01 coach K (published) · 02 client C · 03 stranger S · 04 coach M (draft) · 05 admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('ce000000-0000-0000-0000-000000000001'::uuid, 'kai@ops.local', '{"full_name":"Kai","username":"kai_ops"}'),
  ('ce000000-0000-0000-0000-000000000002'::uuid, 'cleo@ops.local', '{"full_name":"Cleo","username":"cleo_ops"}'),
  ('ce000000-0000-0000-0000-000000000003'::uuid, 'sam@ops.local', '{"full_name":"Sam","username":"sam_ops"}'),
  ('ce000000-0000-0000-0000-000000000004'::uuid, 'max@ops.local', '{"full_name":"Max","username":"max_ops"}'),
  ('ce000000-0000-0000-0000-000000000005'::uuid, 'ada@ops.local', '{"full_name":"Ada","username":"ada_ops"}');
update public.users set role = 'admin' where id = 'ce000000-0000-0000-0000-000000000005';
update public.users set avatar_url = 'https://res.cloudinary.com/x/kai.jpg' where id = 'ce000000-0000-0000-0000-000000000001';
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000004'); select public.become_coach(); reset role;
update public.coach_profiles set headline = 'Old headline', about = 'Old about.', online = true,
       status = 'published', published_at = now(), accepting_clients = true
 where slug = 'kai-ops';
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, (select s.id from public.specializations s where s.active order by s.sort_order limit 1), true
from public.coach_profiles cp where cp.slug = 'kai-ops';
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit)
select 'ceb00000-0000-0000-0000-000000000001', id, 'Coaching', 20000, 'month' from public.coach_profiles where slug = 'kai-ops';
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit)
select 'ceb00000-0000-0000-0000-000000000002', id, 'Old offer', 10000, 'session' from public.coach_profiles where slug = 'kai-ops';
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit)
select 'ceb00000-0000-0000-0000-000000000009', id, 'Max thing', 10000, 'session' from public.coach_profiles where slug = 'max-ops';
insert into public.coach_certifications (id, coach_profile_id, name)
select 'cec00000-0000-0000-0000-000000000001', id, 'Old cert' from public.coach_profiles where slug = 'kai-ops';
-- a session points at "Old offer": removing it must keep the row
insert into public.bookings (client_id, coach_id, service_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
values ('ce000000-0000-0000-0000-000000000002', 'ce000000-0000-0000-0000-000000000001', 'ceb00000-0000-0000-0000-000000000002',
        'Old offer', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'UTC',
        now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'completed');
create or replace function pg_temp.live_headline() returns text language sql security definer as $fn$
  select headline from public.coach_profiles where slug = 'kai-ops';
$fn$;
create or replace function pg_temp.rev_status() returns text language sql security definer as $fn$
  select r.status from public.coach_profile_revisions r join public.coach_profiles cp on cp.id = r.coach_profile_id where cp.slug = 'kai-ops';
$fn$;
create temp table p (name text primary key, payload jsonb);
create temp table kid as select id from public.coach_profiles where slug = 'kai-ops';
grant select on kid to authenticated;
grant select, insert, update on p to authenticated;

-- ============================================================================
-- 1. editing a published profile never takes it offline
-- ============================================================================
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
insert into p values ('start', public.coach_revision_start());
select is((select payload ->> 'headline' from p where name = 'start'), 'Old headline', 'a revision starts as a copy of what is live');
select is(jsonb_array_length((select payload -> 'services' from p where name = 'start')), 2, 'with the services');
select is(public.coach_revision_start(), (select payload from p where name = 'start'), 'starting again reopens the same copy');
select throws_ok($$ select public.coach_set_specializations(array['strength'], 'strength') $$,
  '55000', 'PROFILE_LOCKED', 'live content still cannot be written directly');
insert into p values ('edit', (select payload from p where name = 'start') || '{"headline": "New headline"}'::jsonb);
select is(public.coach_revision_save((select payload from p where name = 'edit')), '{}'::text[], 'a complete edit saves, nothing missing');
reset role;
select is(pg_temp.live_headline(), 'Old headline', 'the live profile is unchanged');
select pg_temp.anonymous();
select is(public.coach_public_profile('kai-ops') ->> 'headline', 'Old headline', 'and so is the public page');
select isnt(public.coach_public_profile('kai-ops'), null, 'which stays online');
reset role;

-- invalid and incomplete copies
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.coach_revision_save((select payload from p where name = 'edit')
                    || '{"specializations": [{"slug": "no-such-thing", "is_primary": true}]}'::jsonb) $$,
  '22023', null, 'a copy the tables refuse (unknown specialization) is refused');
select throws_ok($$ select public.coach_revision_save((select payload from p where name = 'edit')
                    || jsonb_build_object('services', jsonb_build_array(jsonb_build_object('id', 'ceb00000-0000-0000-0000-000000000009',
                         'name', 'Stolen', 'kind', 'other', 'price_unit', 'custom')))) $$,
  '22023', null, 'and so is one that names another coach''s service');
reset role;
select is((select count(*)::int from public.coach_specializations cs join public.coach_profiles cp on cp.id = cs.coach_profile_id
           where cp.slug = 'kai-ops'), 1, 'a refused copy leaves the live rows as they were');
select is((select name from public.coach_services where id = 'ceb00000-0000-0000-0000-000000000009'), 'Max thing',
  'and the other coach''s service untouched');
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
select is(public.coach_revision_save((select payload from p where name = 'edit') || '{"services": []}'::jsonb),
  array['SERVICE'], 'an incomplete copy saves, and says what is missing');
select is(public.coach_revision_submit(), array['SERVICE'], 'but cannot be submitted');
select is(pg_temp.rev_status(), 'editing', 'it stays in editing');
reset role;
select is((select count(*)::int from public.coach_services sv join public.coach_profiles cp on cp.id = sv.coach_profile_id
           where cp.slug = 'kai-ops' and sv.active), 2, 'the live services were never touched');

-- the real edit: new headline, a new service, "Old offer" removed, the certificate removed
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
update p set payload = (select payload from p where name = 'start') || jsonb_build_object(
  'headline', 'New headline',
  'services', jsonb_build_array(
    jsonb_build_object('id', 'ceb00000-0000-0000-0000-000000000001', 'name', 'Coaching, renamed', 'kind', 'online_coaching',
                       'delivery', 'online', 'price_cents', 25000, 'currency', 'RON', 'price_unit', 'month', 'price_public', true,
                       'active', true, 'sort_order', 0),
    jsonb_build_object('id', 'ceb0000a-0000-0000-0000-000000000001', 'name', 'New consult', 'kind', 'consultation',
                       'delivery', 'online', 'price_cents', null, 'currency', 'RON', 'price_unit', 'free', 'price_public', true,
                       'active', true, 'sort_order', 1)),
  'certifications', '[]'::jsonb) where name = 'edit';
select is(public.coach_revision_save((select payload from p where name = 'edit')), '{}'::text[], 'the full edit saves');
select is(public.coach_revision_submit(), '{}'::text[], 'and is submitted');
reset role;
select is(pg_temp.rev_status(), 'pending_review', 'it waits for an admin');

-- ============================================================================
-- 2. nobody else touches it
-- ============================================================================
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.coach_revision_save('{}'::jsonb) $$, 'P0002', 'NO_COACH_PROFILE', 'a stranger has no revision to write');
select throws_ok($$ select * from public.coach_profile_revisions $$, '42501', null, 'nor any to read');
select is(public.coach_my_revision(), null, 'their own is nothing');
reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.admin_decide_coach_revision((select id from public.coach_profiles where slug = 'kai-ops'), true) $$,
  '42501', 'ADMIN_ONLY', 'a coach cannot approve their own changes');
reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.coach_revision_start() $$, '22023', 'BAD_TRANSITION', 'a draft is edited directly, not through a revision');
select lives_ok($$ select public.coach_set_specializations(array[(select slug from public.specializations where active order by sort_order limit 1)], null) $$,
  'and the draft''s own writes still work through the wrappers');
reset role;
select pg_temp.anonymous();
select throws_ok($$ select public.coach_revision_start() $$, '42501', null, 'anonymous: nothing');
reset role;

-- ============================================================================
-- 3. the admin decides
-- ============================================================================
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.admin_coach_revisions_pending() where slug = 'kai-ops'), 1, 'the admin sees it waiting');
select is(public.admin_coach_revision((select id from public.coach_profiles where slug = 'kai-ops')) #>> '{live,headline}', 'Old headline',
  'live and proposed side by side');
select throws_ok($$ select public.admin_decide_coach_revision((select id from public.coach_profiles where slug = 'kai-ops'), false) $$,
  '22023', 'REASON_REQUIRED', 'a rejection needs a reason');
select lives_ok($$ select public.admin_decide_coach_revision((select id from public.coach_profiles where slug = 'kai-ops'), false,
                   'Please describe the consult.') $$, 'the admin rejects it');
reset role;
select is(pg_temp.rev_status(), 'rejected', 'rejected');
select is(pg_temp.live_headline(), 'Old headline', 'the live page still unchanged');
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
select is(public.coach_my_revision() ->> 'review_note', 'Please describe the consult.', 'the coach reads why');
select is(public.coach_revision_save((select payload from p where name = 'edit')), '{}'::text[], 'edits again');
select is(public.coach_revision_submit(), '{}'::text[], 'and resubmits');
reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_decide_coach_revision((select id from public.coach_profiles where slug = 'kai-ops'), true) $$,
  'the admin approves');
reset role;
select is(pg_temp.live_headline(), 'New headline', 'the copy is live now');
select is((select name from public.coach_services where id = 'ceb00000-0000-0000-0000-000000000001'), 'Coaching, renamed', 'an edited service, edited in place');
select is((select name from public.coach_services where id = 'ceb0000a-0000-0000-0000-000000000001'), 'New consult', 'a new service, added');
select is((select active from public.coach_services where id = 'ceb00000-0000-0000-0000-000000000002'), false,
  'a removed service a booking points at is switched off, not deleted');
select is((select count(*)::int from public.coach_certifications where id = 'cec00000-0000-0000-0000-000000000001'), 0, 'a removed certificate is removed');
select is(pg_temp.rev_status(), null, 'and the revision is closed');
select is((select count(*)::int from public.admin_audit_events where metadata ->> 'op' = 'coach_revision'), 2, 'both decisions audited');

-- discard
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.coach_revision_start() $$, 'a new revision');
select lives_ok($$ select public.coach_revision_save(public.coach_revision_start() || '{"headline": "Never mind"}'::jsonb) $$, 'edited');
select lives_ok($$ select public.coach_revision_discard() $$, 'and discarded');
select is(public.coach_my_revision(), null, 'gone');
reset role;
select is(pg_temp.live_headline(), 'New headline', 'the live page never saw it');

-- ============================================================================
-- 4. the overview, and the "started" notice
-- ============================================================================
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000002');
create temp table rq as select public.request_coaching((select id from kid), null, 'Hi Kai') as id;
grant select on rq to authenticated;
reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000001');
select is((public.coach_marketplace_overview() #>> '{requests,pending}')::int, 1, 'the coach''s overview counts the pending request');
select lives_ok($$ select public.accept_coaching_request((select id from rq)) $$, 'accept');
select lives_ok($$ select public.start_coaching_from_request((select id from rq)) $$, 'start coaching');
select is((public.coach_marketplace_overview() #>> '{clients,active}')::int, 1, 'one active client');
reset role;
select is((select count(*)::int from public.notifications where user_id = 'ce000000-0000-0000-0000-000000000002'
           and category::text = 'coaching_request' and payload ->> 'event' = 'started'), 1, 'the client is told coaching started');
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000003');
select is(public.coach_marketplace_overview() -> 'profile', 'null'::jsonb, 'a stranger''s overview has no profile');
select is((public.coach_marketplace_overview() #>> '{requests,pending}')::int, 0, 'and none of Kai''s numbers');
reset role;

select * from finish();
rollback;
