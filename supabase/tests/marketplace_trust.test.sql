-- pgTAP · Marketplace trust & moderation (20261110100000 + 20261110110000)
--
-- A coach profile is reported through the one existing reporting path
-- (social_report), next to reviews; reports are never readable from the
-- app; only an admin lists and resolves them; acting on a profile or a
-- review closes its reports; suspending removes a coach from every public
-- door while relationships, bookings and reviews stay; a hidden review leaves
-- the aggregates and comes back on restore; coaches are told outcomes
-- without the moderator; verification decisions notify; nobody but an admin
-- moves any of it.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs marketplace_trust

begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

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
-- run a statement, swallow any error (for "it had no effect" checks)
create or replace function pg_temp.try(p_sql text) returns void language plpgsql as $fn$
begin
  execute p_sql;
exception when others then
  null;
end;
$fn$;

-- 01 coach Kai · 02 coach Mo (draft) · 03 Rita (reporter) · 04 Ravi (reporter) · 05 Ada (admin)
-- 06 Cleo (Kai's client, reviews him) · 07 Tom (reporter)
insert into auth.users (id, email, raw_user_meta_data) values
  ('ad000000-0000-0000-0000-000000000001'::uuid, 'kai@trust.local', '{"full_name":"Kai","username":"kai_trust"}'),
  ('ad000000-0000-0000-0000-000000000002'::uuid, 'mo@trust.local', '{"full_name":"Mo","username":"mo_trust"}'),
  ('ad000000-0000-0000-0000-000000000003'::uuid, 'rita@trust.local', '{"full_name":"Rita","username":"rita_trust"}'),
  ('ad000000-0000-0000-0000-000000000004'::uuid, 'ravi@trust.local', '{"full_name":"Ravi","username":"ravi_trust"}'),
  ('ad000000-0000-0000-0000-000000000005'::uuid, 'ada@trust.local', '{"full_name":"Ada Admin","username":"ada_trust"}'),
  ('ad000000-0000-0000-0000-000000000006'::uuid, 'cleo@trust.local', '{"full_name":"Cleo","username":"cleo_trust"}'),
  ('ad000000-0000-0000-0000-000000000007'::uuid, 'tom@trust.local', '{"full_name":"Tom","username":"tom_trust"}');
update public.users set role = 'admin' where id = 'ad000000-0000-0000-0000-000000000005';

select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000002'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now(), headline = 'Strength coach', about = 'About Kai',
       online = true, accepting_clients = true
 where slug = 'kai-trust';
create temp table ids as select slug, id from public.coach_profiles;
grant select on ids to authenticated, anon;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$ select id from ids where slug = p_slug; $fn$;
create or replace function pg_temp.reports(p_kind text) returns int language sql security definer as $fn$
  select count(*)::int from public.social_reports r where public.social_report_kind(r) = p_kind;
$fn$;
create or replace function pg_temp.notices(p_user uuid, p_event text) returns int language sql security definer as $fn$
  select count(*)::int from public.notifications
  where user_id = p_user and category::text = 'marketplace' and payload ->> 'event' = p_event;
$fn$;
create or replace function pg_temp.in_search(p_slug text) returns boolean language sql as $fn$
  select exists (select 1 from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i where i ->> 'slug' = p_slug);
$fn$;

-- the coaching that keeps going through moderation, and a credential with a private number
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('ad000000-0000-0000-0000-000000000001', 'ad000000-0000-0000-0000-000000000006', 'active', now() - interval '20 days');
insert into public.bookings (client_id, coach_id, service_name, start_at, end_at, timezone, block_start, block_end, status) values
  ('ad000000-0000-0000-0000-000000000006', 'ad000000-0000-0000-0000-000000000001', 'PT',
   now() + interval '3 days', now() + interval '3 days' + interval '1 hour', 'UTC',
   now() + interval '3 days', now() + interval '3 days' + interval '1 hour', 'confirmed');
insert into public.coach_certifications (coach_profile_id, name, issuer, year, credential_number)
values (pg_temp.pid('kai-trust'), 'NASM CPT', 'NASM', 2020, 'CRED-SECRET-77');

-- ============================================================================
-- 1. reporting a coach profile: the one existing path
-- ============================================================================
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'fake_credentials', 'The certificate looks edited') $$,
  'a user reports a coach profile for fake credentials');
select lives_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'spam') $$,
  'a second report of the same coach by the same person is accepted silently…');
reset role;
select is(pg_temp.reports('coach'), 1, '…and not stored: one report per person and coach');
select is((select reason from public.social_reports where reported_coach_profile_id = pg_temp.pid('kai-trust')), 'fake_credentials',
  'the reason is kept from the fixed list');

select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.social_report('user', 'ad000000-0000-0000-0000-000000000004', 'fake_credentials') $$,
  '22023', 'unknown reason', '"fake credentials" belongs to a coach profile only');
select throws_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'boring') $$,
  '22023', 'unknown reason', 'a reason outside the list is refused');
select throws_ok($$ select public.social_report('coach', pg_temp.pid('mo-trust'), 'spam') $$,
  'P0002', 'coach not found', 'a coach the public cannot see cannot be reported');
select throws_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'other', repeat('x', 501)) $$,
  '22023', 'details too long', 'details are capped');
select throws_ok($$ select * from public.social_reports $$, '42501', null, 'a reporter cannot read reports back');
reset role;

select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'spam') $$,
  '22023', 'cannot report your own profile', 'a coach cannot report themselves');
select throws_ok($$ select count(*) from public.social_reports $$, '42501', null, 'the reported coach cannot read who reported them');
reset role;

select pg_temp.anonymous();
select throws_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'spam') $$,
  '42501', null, 'an anonymous visitor cannot report');
reset role;

-- ============================================================================
-- 2. reporting a review: the same path
-- ============================================================================
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000006');
select lives_ok($$ select public.submit_coach_review(pg_temp.pid('kai-trust'), 5, 'Great coach') $$, 'the client reviews the coach');
reset role;
create temp table rv as select id from public.coach_reviews where reviewer_id = 'ad000000-0000-0000-0000-000000000006';
grant select on rv to authenticated;
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000004');
select lives_ok($$ select public.social_report('review', (select id from rv), 'false_information') $$, 'a user reports the review');
select lives_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'impersonation') $$, 'and reports the coach too');
reset role;
select is(pg_temp.reports('review'), 1, 'the review report is stored in the same table');

-- ============================================================================
-- 3. the admin's queue
-- ============================================================================
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000003');
select throws_ok($$ select * from public.admin_reports() $$, '42501', 'ADMIN_ONLY', 'the queue is admin-only');
select throws_ok($$ select public.admin_report_counts() $$, '42501', 'ADMIN_ONLY', 'and so are the counts');
select throws_ok($$ select public.admin_resolve_report((select id from rv), 'dismissed') $$, '42501', 'ADMIN_ONLY',
  'a user cannot resolve a report');
reset role;
select pg_temp.anonymous();
select throws_ok($$ select * from public.admin_reports() $$, '42501', null, 'anonymous: no queue at all');
reset role;

select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select is((public.admin_report_counts() ->> 'open')::int, 3, 'the admin sees three open reports');
select is((public.admin_report_counts() ->> 'coach')::int, 2, 'two about the coach');
select is((public.admin_report_counts() ->> 'review')::int, 1, 'one about a review');
select is((select count(*)::int from public.admin_reports(p_kind => 'coach')), 2, 'the coach filter');
select is((select distinct coach_slug from public.admin_reports(p_kind => 'coach')), 'kai-trust', 'each row names the coach profile to open');
select is((select max(open_for_target) from public.admin_reports(p_kind => 'coach')), 2, 'and how many open reports its target has');
select is((select count(*)::int from public.admin_reports(p_coach_profile => pg_temp.pid('kai-trust'))), 3,
  'one coach''s reports include the reports of reviews about them');
select is((select review_body from public.admin_reports(p_kind => 'review')), 'Great coach', 'the reported review is shown to inspect');
select throws_ok($$ select public.admin_resolve_report((select id from public.admin_reports(p_kind => 'coach') limit 1), 'closed') $$,
  '22023', 'BAD_STATUS', 'only reviewed or dismissed');
select is(public.admin_resolve_report((select id from public.admin_reports(p_kind => 'coach') limit 1), 'dismissed', 'No evidence'), 2,
  'dismissing closes every open report of that coach');
reset role;
select is((select count(*)::int from public.social_reports
            where reported_coach_profile_id = pg_temp.pid('kai-trust') and status = 'dismissed'
              and resolved_at is not null and resolved_by = 'ad000000-0000-0000-0000-000000000005'
              and resolution_note = 'No evidence'), 2, 'with when, who and why');
select is((select count(*)::int from public.admin_audit_events where entity_type = 'social_report'), 1, 'the decision is audited');
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.admin_resolve_report((select id from public.admin_reports(p_kind => 'coach', p_status => 'dismissed') limit 1), 'reviewed') $$,
  '22023', 'REPORT_CLOSED', 'a closed report stays closed');
reset role;

-- ============================================================================
-- 4. review moderation: hidden stays in the table, leaves the aggregates
-- ============================================================================
select is((select review_count from public.coach_profiles where slug = 'kai-trust'), 1, 'the review counts');
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_set_review_status((select id from rv), 'hidden', 'Not about the coaching') $$, 'the admin hides the review');
reset role;
select is((select status from public.coach_reviews where id = (select id from rv)), 'hidden', 'the review is kept, hidden');
select is((select review_count from public.coach_profiles where slug = 'kai-trust'), 0, 'and leaves the count');
select is((select review_avg from public.coach_profiles where slug = 'kai-trust'), null, 'and the average');
select is((public.coach_public_reviews('kai-trust') -> 'items')::text, '[]', 'and the public list');
select is((select status from public.social_reports where reported_review_id = (select id from rv)), 'reviewed',
  'its open report is closed as acted on');
select ok((select resolved_at is not null from public.social_reports where reported_review_id = (select id from rv)), 'with a time');
select is(pg_temp.notices('ad000000-0000-0000-0000-000000000001', 'review_hidden'), 1, 'the coach is told a review was hidden');
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_set_review_status((select id from rv), 'published') $$, 'the admin restores it');
reset role;
select is((select review_count from public.coach_profiles where slug = 'kai-trust'), 1, 'restored: it counts again');
select is((select review_avg from public.coach_profiles where slug = 'kai-trust'), 5.00::numeric, 'and the average is right');

-- ============================================================================
-- 5. suspension: off every public door, nothing deleted
-- ============================================================================
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000007');
select lives_ok($$ select public.social_report('coach', pg_temp.pid('kai-trust'), 'harassment') $$, 'a new report arrives');
reset role;
select ok(pg_temp.in_search('kai-trust'), 'before: the coach is in discovery');

select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('kai-trust'), 'suspended', 'x') $$,
  '42501', 'ADMIN_ONLY', 'a user cannot suspend a coach');
reset role;
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('kai-trust'), 'suspended', 'Repeated harassment reports') $$,
  'the admin suspends the profile');
reset role;

select pg_temp.anonymous();
select ok(not pg_temp.in_search('kai-trust'), 'suspended: not in /coaches or any city / specialization listing (search_coaches)');
select ok(not exists (select 1 from public.coach_sitemap() where slug = 'kai-trust'), 'not in the sitemap');
select is(public.coach_public_profile('kai-trust'), null, 'no public page');
reset role;
select is((select count(*)::int from public.coach_public_visible('kai-trust')), 0, 'no public door at all (the gate every public RPC uses)');
select is((select status from public.social_reports where reported_coach_profile_id = pg_temp.pid('kai-trust') and status <> 'dismissed'),
  'reviewed', 'the open report is settled by the suspension');
select is((select status::text from public.trainer_clients where coach_id = 'ad000000-0000-0000-0000-000000000001'), 'active',
  'the coaching relationship is untouched');
select is((select count(*)::int from public.bookings where coach_id = 'ad000000-0000-0000-0000-000000000001' and status = 'confirmed'), 1,
  'the booking is untouched');
select is((select count(*)::int from public.coach_reviews where coach_id = 'ad000000-0000-0000-0000-000000000001'), 1, 'the review is kept');
select is(pg_temp.notices('ad000000-0000-0000-0000-000000000001', 'profile_suspended'), 1, 'the coach is told');
select ok(not exists (select 1 from public.notifications where user_id = 'ad000000-0000-0000-0000-000000000001'
                        and category::text = 'marketplace'
                        and (body ilike '%Ada%' or title ilike '%Ada%' or payload ? 'actor_id' or body ilike '%harassment%')),
  'the notice names no moderator, carries no actor and no report');

-- the coach cannot lift it themselves
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000001');
select pg_temp.try($$ update public.coach_profiles set status = 'published' where slug = 'kai-trust' $$);
reset role;
select is((select status from public.coach_profiles where slug = 'kai-trust'), 'suspended', 'a coach cannot unsuspend their own profile');

select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('kai-trust'), 'published') $$, 'the admin restores it');
reset role;
select ok(pg_temp.in_search('kai-trust'), 'restored: back in discovery');
select is(pg_temp.notices('ad000000-0000-0000-0000-000000000001', 'profile_restored'), 1, 'and the coach is told');

-- ============================================================================
-- 6. verification
-- ============================================================================
update public.coach_profiles set verification_status = 'pending', verification_requested_at = now() where slug = 'kai-trust';
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.admin_set_coach_verification_status(pg_temp.pid('kai-trust'), 'verified') $$,
  '42501', 'ADMIN_ONLY', 'a coach cannot verify themselves');
reset role;
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_set_coach_verification_status(pg_temp.pid('kai-trust'), 'verified') $$, 'the admin verifies');
reset role;
select is(pg_temp.notices('ad000000-0000-0000-0000-000000000001', 'verification_verified'), 1, 'the coach is told they are verified');
select pg_temp.authenticate_as('ad000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_set_coach_verification_status(pg_temp.pid('kai-trust'), 'rejected', 'Certificate expired') $$,
  'and can revoke it, with a reason');
reset role;
select is(pg_temp.notices('ad000000-0000-0000-0000-000000000001', 'verification_rejected'), 1, 'the coach is told, without the note');

select pg_temp.anonymous();
select ok(public.coach_public_profile('kai-trust')::text not like '%CRED-SECRET-77%', 'a credential number never reaches the public page');
reset role;

select * from finish();
rollback;
