-- pgTAP · Coach Marketplace launch readiness (20261112100000) and a cross-entity IDOR sweep
--
-- 1. Ratings follow what the public sees: a suspended or deleting reviewer's
--    review leaves the count, the average and the distribution (and comes
--    back on restore); a hidden one never counts.
-- 2. Engagement cannot be pumped by one client re-sending requests, nor by
--    saves from suspended accounts.
-- 3. Notices: a revision decision tells the coach; a completed session asks
--    the client for a review, once.
-- 4. Operations: the admin summary and attention queue, admin-only; a
--    credential decision audited with from / to.
-- 5. Moderation journey: published → reported → suspended → gone from
--    search, sitemap, facets and the public page; the report closed.
-- 6. IDOR: user B cannot read or change user A's bookings, relationships,
--    messages, requests, saves, reviews, calendar, reports or analytics, and
--    no non-admin reaches an admin door.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs marketplace_launch

begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

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
create or replace function pg_temp.stat(p_slug text) returns text language sql security definer as $fn$
  select review_count || '/' || coalesce(review_avg::text, '-') || '/' || array_to_string(review_distribution, ',')
  from public.coach_profiles where slug = p_slug;
$fn$;

-- 01 coach Kai · 02 coach Mo · 03 client Ana · 04 client Bob · 05 admin · 06 reviewer Sam · 07 reviewer Tia
insert into auth.users (id, email, raw_user_meta_data)
select ('de000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, u || '@launch.local',
       json_build_object('full_name', initcap(u), 'username', u)::jsonb
from (values (1, 'kai_l'), (2, 'mo_l'), (3, 'ana_l'), (4, 'bob_l'), (5, 'adm_l'), (6, 'sam_l'), (7, 'tia_l')) v(n, u);
update public.users set role = 'admin' where id = 'de000000-0000-0000-0000-000000000005';
update public.users set timezone = 'Europe/Bucharest', avatar_url = 'https://res.cloudinary.com/d/image/upload/a.jpg'
 where id::text like 'de000000-%';
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000001'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000002'); select public.become_coach(); reset role;
update public.coach_profiles set status = 'published', published_at = now() - interval '30 days', headline = 'Coach',
       about = 'A complete profile.', online = true
 where slug in ('kai-l', 'mo-l');
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, true from public.coach_profiles cp, public.specializations s where cp.slug in ('kai-l', 'mo-l') and s.slug = 'strength';
insert into public.coach_services (id, coach_profile_id, name, price_cents, price_unit, delivery)
select 'deb00000-0000-0000-0000-000000000001'::uuid, id, 'Call', 10000, 'session', 'online' from public.coach_profiles where slug = 'kai-l';
insert into public.coach_certifications (id, coach_profile_id, name)
select 'dec00000-0000-0000-0000-000000000001'::uuid, id, 'Cert' from public.coach_profiles where slug = 'kai-l';

-- ============================================================================
-- 1. ratings follow what the public sees
-- ============================================================================
insert into public.coach_reviews (reviewer_id, coach_id, basis, rating, status) values
  ('de000000-0000-0000-0000-000000000003', 'de000000-0000-0000-0000-000000000001', 'coaching', 4, 'published'),
  ('de000000-0000-0000-0000-000000000006', 'de000000-0000-0000-0000-000000000001', 'coaching', 5, 'published'),
  ('de000000-0000-0000-0000-000000000007', 'de000000-0000-0000-0000-000000000001', 'coaching', 1, 'hidden');
select is(pg_temp.stat('kai-l'), '2/4.50/0,0,0,1,1', 'two published reviews count; the hidden one never does');
update public.users set suspended_at = now() where id = 'de000000-0000-0000-0000-000000000006';
select is(pg_temp.stat('kai-l'), '1/4.00/0,0,0,1,0', 'a suspended reviewer''s review leaves the rating, like it leaves the list');
update public.users set suspended_at = null where id = 'de000000-0000-0000-0000-000000000006';
select is(pg_temp.stat('kai-l'), '2/4.50/0,0,0,1,1', 'restored: it counts again');
insert into public.account_deletion_requests (user_id) values ('de000000-0000-0000-0000-000000000006');
select is(pg_temp.stat('kai-l'), '1/4.00/0,0,0,1,0', 'a reviewer being deleted does not count');
delete from public.account_deletion_requests where user_id = 'de000000-0000-0000-0000-000000000006';
select is(pg_temp.stat('kai-l'), '2/4.50/0,0,0,1,1', 'a withdrawn deletion counts again');
select pg_temp.anonymous();
select is((public.coach_public_reviews('kai-l') ->> 'count')::int,
          jsonb_array_length(public.coach_public_reviews('kai-l') -> 'items'), 'the public count matches the reviews listed');
reset role;

-- ============================================================================
-- 2. engagement from real, distinct people
-- ============================================================================
insert into public.coaching_requests (client_id, coach_id, status, created_at, resolved_at)
select 'de000000-0000-0000-0000-000000000004', 'de000000-0000-0000-0000-000000000002', 'cancelled',
       now() - make_interval(days => d), now() - make_interval(days => d) + interval '3 days'
from generate_series(5, 9) d;
insert into public.coach_saves (user_id, coach_profile_id)
select 'de000000-0000-0000-0000-000000000006', id from public.coach_profiles where slug = 'mo-l';
update public.users set suspended_at = now() where id = 'de000000-0000-0000-0000-000000000006';
select public.coach_rank_signals_refresh();
select is((select requests_90d from public.coach_rank_signals s join public.coach_profiles cp on cp.id = s.coach_profile_id where cp.slug = 'mo-l'),
  1, 'five requests from one client count once');
select is((select saves_90d from public.coach_rank_signals s join public.coach_profiles cp on cp.id = s.coach_profile_id where cp.slug = 'mo-l'),
  0, 'a suspended account''s save does not count');
update public.users set suspended_at = null where id = 'de000000-0000-0000-0000-000000000006';

-- ============================================================================
-- 3. notices
-- ============================================================================
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000001');
select public.coach_revision_start();
select public.coach_revision_save(public.coach_my_revision_payload() || '{"headline":"Strength coach"}'::jsonb);
select public.coach_revision_submit();
reset role;
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000005');
select lives_ok($$ select public.admin_decide_coach_revision((select id from public.coach_profiles where slug = 'kai-l'), true, null) $$,
  'an admin approves the coach''s changes');
reset role;
select is((select count(*)::int from public.notifications where user_id = 'de000000-0000-0000-0000-000000000001'
            and category::text = 'marketplace' and payload ->> 'event' = 'revision_approved'), 1, 'the coach is told');

insert into public.bookings (id, client_id, coach_id, service_id, service_name, start_at, end_at, timezone, block_start, block_end, status)
values ('deb10000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000004', 'de000000-0000-0000-0000-000000000001',
        'deb00000-0000-0000-0000-000000000001', 'Call', now() - interval '3 days', now() - interval '3 days' + interval '1 hour',
        'Europe/Bucharest', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'confirmed'),
       ('deb10000-0000-0000-0000-000000000002', 'de000000-0000-0000-0000-000000000004', 'de000000-0000-0000-0000-000000000001',
        'deb00000-0000-0000-0000-000000000001', 'Call', now() - interval '2 days', now() - interval '2 days' + interval '1 hour',
        'Europe/Bucharest', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'confirmed'),
       ('deb10000-0000-0000-0000-000000000003', 'de000000-0000-0000-0000-000000000003', 'de000000-0000-0000-0000-000000000001',
        'deb00000-0000-0000-0000-000000000001', 'Call', now() - interval '1 days', now() - interval '1 days' + interval '1 hour',
        'Europe/Bucharest', now() - interval '1 days', now() - interval '1 days' + interval '1 hour', 'confirmed');
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000001');
select public.mark_booking('deb10000-0000-0000-0000-000000000001', 'completed');
select public.mark_booking('deb10000-0000-0000-0000-000000000002', 'completed');
select public.mark_booking('deb10000-0000-0000-0000-000000000003', 'completed');
reset role;
select is((select count(*)::int from public.notifications where user_id = 'de000000-0000-0000-0000-000000000004'
            and payload ->> 'event' = 'completed'), 1, 'a completed session asks the client for a review — once, not per session');
select is((select count(*)::int from public.notifications where user_id = 'de000000-0000-0000-0000-000000000003'
            and payload ->> 'event' = 'completed'), 0, 'not a client who already reviewed this coach');

-- ============================================================================
-- 4. public availability, operations, audit
-- ============================================================================
select pg_temp.anonymous();
select is((public.coach_public_profile('kai-l') -> 'availability' ->> 'has_hours')::boolean, false,
  'no weekly hours: the page can say Book is not offered');
reset role;

insert into public.social_reports (reporter_id, reported_coach_profile_id, reason)
select 'de000000-0000-0000-0000-000000000003', id, 'spam' from public.coach_profiles where slug = 'mo-l';
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.admin_coach_marketplace_summary((select id from public.coach_profiles where slug = 'kai-l')) $$,
  '42501', null, 'the coach summary is admin-only');
select throws_ok($$ select * from public.admin_coach_attention() $$, '42501', null, 'the attention queue is admin-only');
reset role;
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000005');
select ok((select bool_or('open_reports' = any (reasons)) from public.admin_coach_attention() where slug = 'mo-l'),
  'a reported coach needs attention');
select lives_ok($$ select public.admin_set_certification_status('dec00000-0000-0000-0000-000000000001', 'verified', null) $$,
  'an admin verifies a credential');
select ok(exists (select 1 from public.admin_audit_events e where e.entity_id = 'dec00000-0000-0000-0000-000000000001'
                   and e.metadata ->> 'from' = 'unverified' and e.metadata ->> 'to' = 'verified'
                   and e.actor_user_id = 'de000000-0000-0000-0000-000000000005'),
  'the credential decision is audited: who, from, to');
select ok(jsonb_array_length(public.admin_coach_marketplace_summary((select id from public.coach_profiles where slug = 'kai-l')) -> 'history') >= 2,
  'the coach summary carries the moderation history');
select is((public.admin_coach_marketplace_summary((select id from public.coach_profiles where slug = 'kai-l')) -> 'bookings' ->> 'completed')::int, 3,
  'and the coach''s marketplace numbers');

-- ============================================================================
-- 5. moderation journey
-- ============================================================================
select ok((public.search_coaches(p_accepting => false) -> 'items') @> '[{"slug":"mo-l"}]', 'before: Mo is in search');
select lives_ok($$ select public.admin_set_coach_profile_status((select id from public.coach_profiles where slug = 'mo-l'), 'suspended', 'spam profile') $$,
  'the admin suspends Mo, with a reason');
reset role;
select is((select count(*)::int from public.social_reports where reported_coach_profile_id = (select id from public.coach_profiles where slug = 'mo-l')
            and status = 'open'), 0, 'the report about the profile is closed by the action');
select pg_temp.anonymous();
select ok(not ((public.search_coaches(p_accepting => false) -> 'items') @> '[{"slug":"mo-l"}]'), 'after: gone from search');
select is(public.coach_public_profile('mo-l'), null, 'and from the public page');
select ok(not exists (select 1 from public.coach_sitemap() where slug = 'mo-l'), 'and from the sitemap');
select is((select sum((c ->> 'coaches')::int)::int from jsonb_array_elements(public.coach_discovery_facets() -> 'specializations') c
            where c ->> 'slug' = 'strength'), 1, 'and from landing-page counts');
reset role;
select is((select count(*)::int from public.notifications where user_id = 'de000000-0000-0000-0000-000000000002'
            and payload ->> 'event' = 'profile_suspended'), 1, 'the coach is told, without the reporter');
select ok(exists (select 1 from public.admin_audit_events e where e.entity_type = 'coach_profile'
                   and e.metadata ->> 'from' = 'published' and e.metadata ->> 'to' = 'suspended' and e.metadata ->> 'reason' = 'spam profile'),
  'the suspension is audited with from, to and reason');

-- ============================================================================
-- 6. IDOR: Bob is not Ana, Mo is not Kai
-- ============================================================================
insert into public.trainer_clients (id, coach_id, client_id, status, started_at)
values ('de710000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000003', 'active', now());
insert into public.conversations (id, coach_id, client_id)
values ('dec10000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000003');
insert into public.messages (conversation_id, sender_id, body)
values ('dec10000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000003', 'private');
insert into public.coaching_requests (client_id, coach_id, status, message)
values ('de000000-0000-0000-0000-000000000003', 'de000000-0000-0000-0000-000000000001', 'pending', 'private request');
insert into public.coach_saves (user_id, coach_profile_id)
select 'de000000-0000-0000-0000-000000000003', id from public.coach_profiles where slug = 'kai-l';
select public.calendar_connection_open('de000000-0000-0000-0000-000000000001', 'google', 'kai@x.test', '{}');

select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.bookings where client_id = 'de000000-0000-0000-0000-000000000003'), 0, 'Bob reads none of Ana''s bookings');
select throws_ok($$ select public.cancel_booking('deb10000-0000-0000-0000-000000000003') $$, null, null, 'nor cancels one');
select is((select count(*)::int from public.trainer_clients where client_id = 'de000000-0000-0000-0000-000000000003'), 0, 'nor reads her coaching');
select throws_ok($$ select public.coaching_transition('de710000-0000-0000-0000-000000000001', 'ended', 'other') $$, null, null, 'nor ends it');
select is((select count(*)::int from public.messages where conversation_id = 'dec10000-0000-0000-0000-000000000001'), 0, 'nor reads her messages');
select throws_ok($$ insert into public.messages (conversation_id, sender_id, body) values ('dec10000-0000-0000-0000-000000000001', auth.uid(), 'x') $$,
  '42501', null, 'nor writes into her conversation');
select is((select count(*)::int from public.coaching_requests where client_id = 'de000000-0000-0000-0000-000000000003'), 0, 'nor reads her requests');
select is((select count(*)::int from public.coach_saves where user_id = 'de000000-0000-0000-0000-000000000003'), 0, 'nor her saved coaches');
delete from public.coach_saves where user_id = 'de000000-0000-0000-0000-000000000003';
reset role;
select is((select count(*)::int from public.coach_saves where user_id = 'de000000-0000-0000-0000-000000000003'), 1, 'and cannot delete them');
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000004');
select throws_ok($$ update public.coach_reviews set rating = 1 where reviewer_id = 'de000000-0000-0000-0000-000000000003' $$,
  '42501', null, 'nor edits her review');
select throws_ok($$ select count(*) from public.social_reports $$, '42501', null, 'nobody reads reports through the API');
select throws_ok($$ select count(*) from public.marketplace_events $$, '42501', null, 'nor the analytics log');
select is((select count(*)::int from public.admin_audit_events), 0, 'nor the audit trail (admins only)');
select throws_ok($$ select public.admin_set_coach_profile_status((select id from public.coach_profiles limit 1), 'suspended', 'x') $$,
  '42501', null, 'a non-admin cannot moderate');
select throws_ok($$ select public.admin_set_review_status((select id from public.coach_reviews limit 1), 'hidden', 'x') $$,
  null, null, 'nor hide a review');
reset role;
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.coach_profiles where slug = 'kai-l'), 0, 'Mo reads none of Kai''s private profile row');
select is((select count(*)::int from public.calendar_connections), 0, 'nor his calendar connection');
select is((select count(*)::int from public.coach_certifications where coach_profile_id = (select id from public.coach_profiles where slug = 'kai-l')), 0,
  'nor his credential numbers');
select throws_ok($$ select public.mark_booking('deb10000-0000-0000-0000-000000000003', 'no_show') $$, null, null, 'nor marks his bookings');
reset role;
select pg_temp.anonymous();
select ok(not (public.coach_public_profile('kai-l')::text ~ '(credential_number|review_note|suspension_reason|verification_note|access_token)'),
  'the public payload carries no private field');
reset role;

select * from finish();
rollback;
