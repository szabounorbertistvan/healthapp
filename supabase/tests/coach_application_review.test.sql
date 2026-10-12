-- pgTAP · Coach applications: mandatory review with evidence (20261118100000)
--
-- The rule: nobody is public until an admin approves. Seven coaches, one per
-- state — approved, pending, more information requested, rejected, a complete
-- draft never submitted, approved then revoked, and a legacy profile published
-- before documents existed — then every public door is asked about each one,
-- anonymously and signed in. Around that: who may move an application (only an
-- admin, only through the checklist), the evidence it needs, private documents
-- (owner and admin only, validated, no direct writes; qualifications only — no identity
-- documents since 20261119100000), the decision history,
-- the notifications, and protected columns a coach cannot write.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_application_review

begin;
create extension if not exists pgtap with schema extensions;
select plan(108);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
create or replace function pg_temp.anonymous()
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$fn$;
create or replace function pg_temp.uid(n int) returns uuid language sql as $fn$
  select ('ca000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$fn$;
-- profile ids captured by the owner of the tables (RLS hides coach_profiles from a client), readable by every role
create temp table ids (slug text primary key, id uuid);
grant select on ids to anon, authenticated;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$
  select id from ids where slug = p_slug;
$fn$;
-- every slug the public listing shows, whatever filter
create or replace function pg_temp.listed() returns text[] language sql as $fn$
  select coalesce(array_agg(distinct x), '{}') from (
    select i ->> 'slug' as x from jsonb_array_elements(public.search_coaches(p_accepting => false, p_limit => 100) -> 'items') i
    union all select i ->> 'slug' from jsonb_array_elements(public.search_coaches(p_query => 'zumbacoach', p_accepting => false, p_limit => 100) -> 'items') i
    union all select i ->> 'slug' from jsonb_array_elements(public.search_coaches(p_city => 'cluj-napoca', p_accepting => false, p_limit => 100) -> 'items') i
    union all select i ->> 'slug' from jsonb_array_elements(public.search_coaches(p_specializations => array['dance-fitness'], p_accepting => false, p_limit => 100) -> 'items') i
    union all select i ->> 'slug' from jsonb_array_elements(public.search_coaches(p_online => true, p_limit => 100) -> 'items') i
  ) t;
$fn$;
-- a coach's slug through every public door; true = it leaked somewhere
create or replace function pg_temp.exposed(p_slug text) returns boolean language sql as $fn$
  select public.coach_public_profile(p_slug) is not null
      or exists (select 1 from public.coach_public_posts(p_slug))
      or jsonb_array_length(coalesce(public.coach_public_programs(p_slug) -> 'items', '[]'::jsonb)) > 0
      or coalesce((public.coach_public_reviews(p_slug) ->> 'count')::int, 0) > 0
      or exists (select 1 from public.coach_booking_services(p_slug))
      or p_slug = any (pg_temp.listed())
      or exists (select 1 from public.coach_sitemap() s where s.slug = p_slug)
      or public.coach_slug_redirect(p_slug || '-old') is not null;
$fn$;

-- 01 appr · 02 pend · 03 more · 04 rej · 05 draftc · 06 revk · 07 legacy · 08 another coach · c1 a client · ad an admin
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.uid(n), u || '@ca.local', json_build_object('full_name', 'Zumbacoach ' || u, 'username', u)::jsonb
from (values (1, 'ca_appr'), (2, 'ca_pend'), (3, 'ca_more'), (4, 'ca_rej'), (5, 'ca_draftc'), (6, 'ca_revk'), (7, 'ca_legacy'), (8, 'ca_other')) v(n, u);
insert into auth.users (id, email, raw_user_meta_data) values
  ('ca000000-0000-0000-0000-0000000000c1', 'client@ca.local', '{"full_name":"Client","username":"ca_client"}'),
  ('ca000000-0000-0000-0000-0000000000ad', 'admin@ca.local', '{"full_name":"Admin","username":"ca_admin"}');
update public.users set role = 'admin' where id = 'ca000000-0000-0000-0000-0000000000ad';
update public.users set timezone = 'Europe/Bucharest', avatar_url = 'https://res.cloudinary.com/demo/image/upload/a.jpg'
 where id::text like 'ca000000-%';

do $$
declare n int;
begin
  for n in 1..8 loop
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(n)::text, 'role', 'authenticated')::text, true);
    perform public.become_coach();
  end loop;
end;
$$;
insert into ids select slug, id from public.coach_profiles where user_id::text like 'ca000000-%';
insert into public.gyms (id, name, city, status) values ('ca000000-0000-0000-0000-00000000a001', 'Ca Gym', 'Cluj-Napoca', 'active');
-- complete drafts (the wizard's writes, done here as the owner of the tables)
update public.coach_profiles set headline = 'Dance coach', about = 'Zumbacoach classes.', online = true, in_person = true,
       accepting_clients = true
 where user_id::text like 'ca000000-%';
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, true from public.coach_profiles cp, public.specializations s
 where cp.user_id::text like 'ca000000-%' and s.slug = 'dance-fitness';
insert into public.coach_locations (coach_profile_id, city_id, gym_id)
select cp.id, c.id, 'ca000000-0000-0000-0000-00000000a001' from public.coach_profiles cp, public.cities c
 where cp.user_id::text like 'ca000000-%' and c.slug = 'cluj-napoca';
insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit, bookable, booking_duration_minutes, booking_access)
select id, 'Class', 'online_coaching', 5000, 'session', true, 60, 'public' from public.coach_profiles where user_id::text like 'ca000000-%';
insert into public.coach_slug_redirects (old_slug, coach_profile_id)
select slug || '-old', id from public.coach_profiles where user_id::text like 'ca000000-%';
-- the fixtures' discipline needs proof of qualification (an admin setting); no identity document
-- is ever asked for (20261119100000)
update public.specializations set qualification_evidence = 'required' where slug = 'dance-fitness';

-- ============================================================================
-- 1. an application needs evidence; documents are validated and private
-- ============================================================================
select pg_temp.authenticate_as(pg_temp.uid(1));
select is(public.submit_coach_for_review(), array['QUALIFICATION_DOCUMENT'], 'a complete profile in a discipline that requires a qualification cannot be submitted without one');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'draft', '… and stays a draft');
select throws_ok($$ select public.coach_add_verification_document('identity', 'voinic/coach-docs/' || auth.uid() || '/idcard00001', 'pdf', 120000) $$,
  '22023', 'IDENTITY_DOCUMENTS_NOT_ACCEPTED', 'an identity document is refused');
select throws_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/ca000000-0000-0000-0000-000000000008/stolen00001', 'pdf', 1000) $$,
  '22023', 'BAD_DOCUMENT_PATH', 'a document must be in the coach''s own folder');
select throws_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/cert0000009', 'exe', 1000) $$,
  '22023', 'BAD_DOCUMENT', 'only PDF and images');
select throws_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/cert0000009', 'pdf', 10485761) $$,
  '22023', 'BAD_DOCUMENT', '10 MB at most');
select throws_ok($$ select public.coach_add_verification_document('selfie', 'voinic/coach-docs/' || auth.uid() || '/cert0000009', 'pdf', 1000) $$,
  '22023', 'BAD_DOCUMENT', 'a known kind only');
select throws_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/cert0000001', 'pdf', 1000, 'Yoga', 'yoga') $$,
  '22023', 'UNKNOWN_SPECIALIZATION', 'a discipline-specific qualification names one of the coach''s own disciplines');
select lives_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/cert0000000', 'pdf', 120000, 'First aid') $$,
  'the coach adds a qualification not tied to a discipline');
select is(public.submit_coach_for_review(), array['QUALIFICATION_DOCUMENT'], '… which does not evidence the discipline that requires one');
select lives_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/cert0000001', 'jpg', 90000, 'Zumba instructor', 'dance-fitness') $$,
  '… and a qualification for one of their disciplines');
select throws_ok($$ insert into public.coach_verification_documents (coach_profile_id, kind, storage_public_id, format, bytes)
                    select id, 'qualification', 'voinic/coach-docs/' || auth.uid() || '/direct00001', 'pdf', 1 from public.coach_profiles where user_id = auth.uid() $$,
  '42501', null, 'no direct insert around the checks');
select throws_ok($$ update public.coach_verification_documents set status = 'accepted' $$,
  '42501', null, 'a coach cannot accept their own document');
select is((select count(*)::int from public.coach_verification_documents), 2, 'the coach reads their own documents');
select is(public.submit_coach_for_review(), '{}'::text[], 'with the qualification for its discipline (and no identity document) the application is submitted');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'pending_review', 'pending review');
select throws_ok($$ select public.coach_add_verification_document('other', 'voinic/coach-docs/' || auth.uid() || '/late0000001', 'pdf', 1000) $$,
  '55000', 'DOCUMENTS_LOCKED', 'documents are frozen while an admin reviews them');
reset role;

select pg_temp.authenticate_as(pg_temp.uid(8));
select is((select count(*)::int from public.coach_verification_documents), 0, 'another coach sees none of them');
select throws_ok($$ select public.admin_coach_application(pg_temp.pid('ca-appr')) $$, '42501', 'ADMIN_ONLY', 'nor reads the application');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.coach_verification_documents), 0, 'a client sees none of them');
reset role;
select pg_temp.anonymous();
select throws_ok($$ select count(*) from public.coach_verification_documents $$, '42501', null, 'anonymous: no access at all');
select throws_ok($$ select count(*) from public.coach_application_decisions $$, '42501', null, 'anonymous: no decision history');
reset role;

-- the other applicants: submitted (2, 3, 4, 6), legacy published directly (7), complete but never submitted (5)
do $$
declare n int;
begin
  for n in select unnest(array[2, 3, 4, 6]) loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(n)::text, 'role', 'authenticated')::text, true);
    perform public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || pg_temp.uid(n) || '/cert0000001', 'png', 50000,
                                                   'Zumba licence', 'dance-fitness');
    perform public.submit_coach_for_review();
    reset role;
  end loop;
end;
$$;
-- a profile published before documents existed, as the migration found it
update public.coach_profiles set status = 'published', published_at = now() - interval '200 days', submitted_at = now() - interval '201 days'
 where slug = 'ca-legacy';
insert into public.coach_application_decisions (coach_profile_id, decision, note)
select id, 'legacy_approved', 'Published before document review (20261118100000); no documents on file.' from public.coach_profiles where slug = 'ca-legacy';

-- ============================================================================
-- 2. only an admin decides, only through the checklist
-- ============================================================================
select pg_temp.authenticate_as(pg_temp.uid(1));
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-appr'), 'approved', null, true, true) $$,
  '42501', 'ADMIN_ONLY', 'a coach cannot approve themselves');
select throws_ok($$ update public.coach_profiles set status = 'published' where user_id = auth.uid() $$, '42501', null, 'nor write status');
select throws_ok($$ update public.coach_profiles set review_decision = null where user_id = auth.uid() $$, '42501', null, 'nor the review outcome');
select throws_ok($$ update public.coach_profiles set reviewed_by = auth.uid() where user_id = auth.uid() $$, '42501', null, 'nor the reviewer');
select throws_ok($$ insert into public.coach_application_decisions (coach_profile_id, decision) select id, 'approved' from public.coach_profiles where user_id = auth.uid() $$,
  '42501', null, 'nor write a decision');
select throws_ok($$ select public.admin_coach_applications() $$, '42501', 'ADMIN_ONLY', 'nor read the queue');
select throws_ok($$ select public.admin_set_verification_document_status((select id from public.coach_verification_documents limit 1), 'accepted') $$,
  '42501', 'ADMIN_ONLY', 'nor judge a document');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-pend'), 'approved', null, true, true) $$,
  '42501', 'ADMIN_ONLY', 'a client cannot approve anyone');
reset role;
select pg_temp.anonymous();
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-pend'), 'approved', null, true, true) $$,
  '42501', null, 'nor can an anonymous caller');
reset role;

select pg_temp.authenticate_as('ca000000-0000-0000-0000-0000000000ad');
select is((public.admin_coach_applications('pending') ->> 'total')::int, 5, 'the queue lists the five pending applications');
select is((select array_agg(i ->> 'slug' order by o) from jsonb_array_elements(public.admin_coach_applications('pending') -> 'items') with ordinality t(i, o))
          [1], 'ca-appr', 'oldest submission first');
select is((select (i ->> 'qualification_documents')::int from jsonb_array_elements(public.admin_coach_applications('pending') -> 'items') i where i ->> 'slug' = 'ca-appr'),
  2, 'with its evidence counted');
select is((public.admin_coach_applications('pending', current_date + 1) ->> 'total')::int, 0, 'and a submitted-since filter');
select throws_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-appr'), 'published') $$,
  '22023', 'USE_APPLICATION_REVIEW', 'the old status switch can no longer approve');
select throws_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-appr'), 'draft', 'x') $$,
  '22023', 'USE_APPLICATION_REVIEW', '… nor send back');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-appr'), 'approved') $$,
  '22023', 'REVIEW_CHECKLIST_INCOMPLETE', 'approval needs the checklist');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-appr'), 'approved', null, true, false) $$,
  '22023', 'REVIEW_CHECKLIST_INCOMPLETE', 'both boxes: profile and qualifications');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-more'), 'changes_requested') $$,
  '22023', 'REASON_REQUIRED', 'asking for more needs instructions');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-rej'), 'rejected', '   ') $$,
  '22023', 'REASON_REQUIRED', 'a rejection needs a reason');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-draftc'), 'approved', null, true, true) $$,
  '22023', 'BAD_TRANSITION', 'a draft that was never submitted cannot be approved');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-appr'), 'published') $$,
  '22023', 'BAD_DECISION', 'an unknown decision is refused');

select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-appr'), 'approved', 'Profile and Zumba licence checked', true, true) $$, 'approved');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-revk'), 'approved', null, true, true) $$, 'approved (to be revoked)');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-more'), 'changes_requested', 'Upload a readable copy of your licence.') $$, 'more information requested');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-rej'), 'rejected', 'The certificate does not match the name.') $$, 'rejected');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-revk'), 'revoked', 'Qualification expired.') $$, 'approval revoked');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-legacy'), 'approved', null, true, true) $$,
  '22023', 'APPLICATION_INCOMPLETE: QUALIFICATION_DOCUMENT', 'a legacy profile cannot be re-approved without evidence');
select is((public.admin_coach_applications('legacy') -> 'items' -> 0 ->> 'slug'), 'ca-legacy', 'legacy approvals have their own queue');

select is((select status || '/' || coalesce(review_decision, '-') from public.coach_profiles where slug = 'ca-appr'), 'published/-', 'approved → published');
select is((select status || '/' || review_decision from public.coach_profiles where slug = 'ca-more'), 'draft/changes_requested', 'more info → a draft marked so');
select is((select status || '/' || review_decision from public.coach_profiles where slug = 'ca-rej'), 'draft/rejected', 'rejected → a draft marked so');
select is((select status || '/' || review_decision from public.coach_profiles where slug = 'ca-revk'), 'draft/revoked', 'revoked → a draft marked so');
select is((select array_agg(status order by kind) from public.coach_verification_documents where coach_profile_id = pg_temp.pid('ca-appr')),
  array['accepted', 'accepted'], 'the reviewed documents are accepted');
select is((select array_agg(kind || ':' || status order by kind) from public.coach_verifications where coach_profile_id = pg_temp.pid('ca-appr')),
  array['certification:verified'], 'the qualification review is recorded; no identity claim is');
select is((select count(*)::int from public.coach_verifications where kind = 'identity' and coach_profile_id in (select id from ids)),
  0, 'approval never records an identity verification');
select is((select array_agg(decision order by created_at) from public.coach_application_decisions where coach_profile_id = pg_temp.pid('ca-revk')),
  array['submitted', 'approved', 'revoked'], 'the history: submitted, approved, revoked');
select ok((select actor_id = 'ca000000-0000-0000-0000-0000000000ad' and profile_reviewed and qualifications_reviewed and not identity_reviewed
             from public.coach_application_decisions where coach_profile_id = pg_temp.pid('ca-appr') and decision = 'approved'),
  'each decision names its reviewer and the checklist');
select ok(exists (select 1 from public.admin_audit_events where metadata ->> 'op' = 'coach_application' and metadata ->> 'decision' = 'revoked'),
  'and is audited');
select is((public.admin_coach_application(pg_temp.pid('ca-appr')) -> 'history' -> 0 ->> 'actor'), 'ca_admin', 'the admin sees who decided');
reset role;

-- ============================================================================
-- 3. every public door, for every state
-- ============================================================================
select pg_temp.anonymous();
select is(pg_temp.exposed('ca-appr'), true, 'anonymous: the approved coach is public');
select is(pg_temp.exposed('ca-legacy'), true, 'anonymous: the legacy coach keeps their visibility');
select is(pg_temp.exposed('ca-pend'), false, 'anonymous: pending review is invisible everywhere');
select is(pg_temp.exposed('ca-more'), false, 'anonymous: more-info-requested is invisible everywhere');
select is(pg_temp.exposed('ca-rej'), false, 'anonymous: rejected is invisible everywhere');
select is(pg_temp.exposed('ca-draftc'), false, 'anonymous: a never-submitted draft is invisible everywhere');
select is(pg_temp.exposed('ca-revk'), false, 'anonymous: a revoked approval is invisible everywhere');
select is((select (f ->> 'coaches')::int from jsonb_array_elements(public.coach_discovery_facets() -> 'specializations') f where f ->> 'slug' = 'dance-fitness'),
  2, 'the facet counts only the two public coaches');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-0000000000c1');
select is(pg_temp.exposed('ca-pend') or pg_temp.exposed('ca-more') or pg_temp.exposed('ca-rej') or pg_temp.exposed('ca-draftc') or pg_temp.exposed('ca-revk'),
  false, 'signed in: no unapproved coach behind any door');
select is((select array_agg(slug order by slug) from public.gym_coaches_at('ca000000-0000-0000-0000-00000000a001')),
  array['ca-appr', 'ca-legacy'], 'the gym page lists only approved coaches');
select is(public.gym_coach_count('ca000000-0000-0000-0000-00000000a001'), 2, '… and counts only them');
select throws_ok($$ select public.request_coaching(pg_temp.pid('ca-pend')) $$, 'P0002', 'COACH_NOT_FOUND', 'nobody can request an unapproved coach');
select is(public.coach_saveable(pg_temp.pid('ca-rej')), false, 'nor save one');
select lives_ok($$ select public.request_coaching(pg_temp.pid('ca-appr')) $$, 'an approved coach can be asked');
reset role;

-- ============================================================================
-- 4. the coach's side: status, the note, the history, a resubmission
-- ============================================================================
select pg_temp.authenticate_as(pg_temp.uid(3));
select is(public.coach_my_application() ->> 'review_decision', 'changes_requested', 'the coach sees that more is needed');
select is(public.coach_my_application() ->> 'review_note', 'Upload a readable copy of your licence.', '… and the instructions');
select ok(not (public.coach_my_application() -> 'history' -> 0 ? 'actor'), 'the history does not name the reviewer');
select is((public.coach_my_application() -> 'documents' -> 0 ->> 'kind'), 'qualification', 'the coach sees their documents');
select ok(not (public.coach_my_application() -> 'documents' -> 0 ? 'storage_public_id'), '… without the storage handle');
select lives_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/licence0002', 'jpg', 40000, 'Licence, readable', 'dance-fitness') $$,
  'the coach adds what was asked for');
select is(public.submit_coach_for_review(), '{}'::text[], '… and resubmits');
select is((select status || '/' || coalesce(review_decision, '-') from public.coach_profiles where user_id = auth.uid()), 'pending_review/-',
  'pending again, the old outcome cleared');
select throws_ok($$ select public.show_coach_profile() $$, null, null, 'a coach cannot switch an unapproved profile on');
reset role;
select pg_temp.authenticate_as(pg_temp.uid(6));
select throws_ok($$ select public.show_coach_profile() $$, null, null, '… nor a revoked one');
select is(public.coach_my_application() ->> 'review_note', 'Qualification expired.', 'the revoked coach reads why');
reset role;
select pg_temp.authenticate_as(pg_temp.uid(1));
select throws_ok($$ select public.coach_remove_verification_document(
    (select id from public.coach_verification_documents where status = 'accepted' limit 1)) $$,
  '55000', 'DOCUMENTS_LOCKED', 'the evidence a live profile was approved on stays');
reset role;
select pg_temp.authenticate_as(pg_temp.uid(8));
select public.coach_add_verification_document('other', 'voinic/coach-docs/' || auth.uid() || '/extra000001', 'pdf', 1000);
select is(public.coach_remove_verification_document((select id from public.coach_verification_documents limit 1)),
  'voinic/coach-docs/ca000000-0000-0000-0000-000000000008/extra000001', 'a coach removes their own document (the server then deletes the file)');
reset role;

-- ============================================================================
-- 5. notifications: every outcome, nothing about the documents
-- ============================================================================
select is((select array_agg(payload ->> 'event' order by created_at, payload ->> 'event') from public.notifications
            where user_id = pg_temp.uid(6) and category = 'marketplace'),
  array['application_submitted', 'profile_published', 'profile_unpublished'], 'submitted, approved, revoked');
select ok(exists (select 1 from public.notifications where user_id = pg_temp.uid(3) and payload ->> 'event' = 'application_changes_requested'),
  'more information requested is notified');
select ok(exists (select 1 from public.notifications where user_id = pg_temp.uid(4) and payload ->> 'event' = 'application_rejected'),
  'a rejection is notified');
select is((select count(*)::int from public.notifications where user_id::text like 'ca000000-%'
            and (body ~* '(passport|pdf|png|jpg|coach-docs|id card)' or payload::text ~* '(coach-docs|storage_public_id|idcard)')),
  0, 'no notification mentions a document');
select is(public.email_rule_delay_minutes('marketplace', 'application_rejected'), 0, 'and the decisions are emailed');

-- ============================================================================
-- 6. suspend and restore keep the rule
-- ============================================================================
select pg_temp.authenticate_as('ca000000-0000-0000-0000-0000000000ad');
select lives_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-pend'), 'suspended', 'spam') $$, 'a pending profile can be suspended');
select throws_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-pend'), 'published') $$,
  '22023', 'BAD_TRANSITION', 'a restore cannot publish a profile that was never approved');
select lives_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-appr'), 'suspended', 'reports') $$, 'an approved profile suspended');
select lives_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-appr'), 'published') $$, '… and restored, approved before');
reset role;
-- a revoked coach who applies again keeps published_at from the old approval; suspending the new
-- application must not turn a restore into an approval
select pg_temp.authenticate_as(pg_temp.uid(6));
select is(public.submit_coach_for_review(), '{}'::text[], 'the revoked coach applies again');
reset role;
select pg_temp.authenticate_as('ca000000-0000-0000-0000-0000000000ad');
select lives_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-revk'), 'suspended', 'spam') $$, 'the new application is suspended');
select is((select suspended_from from public.coach_profiles where id = pg_temp.pid('ca-revk')), 'pending_review', 'the suspension remembers where it came from');
select throws_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-revk'), 'published') $$,
  '22023', 'BAD_TRANSITION', 'a restore cannot publish what was not public when suspended, even with an old published_at');
select lives_ok($$ select public.admin_set_coach_profile_status(pg_temp.pid('ca-revk'), 'draft') $$, '… it can only go back to draft');
reset role;
select pg_temp.anonymous();
select ok(not pg_temp.exposed('ca-revk'), 'and stays off every public door');
reset role;
select pg_temp.authenticate_as(pg_temp.uid(6));
select throws_ok($$ update public.coach_profiles set suspended_from = 'published' where user_id = auth.uid() $$, '42501', null, 'a coach cannot write it');
reset role;

-- ============================================================================
-- 7. a resubmission after "more information" is approved like a first one
-- ============================================================================
select pg_temp.authenticate_as('ca000000-0000-0000-0000-0000000000ad');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-more'), 'approved', null, false, true) $$,
  '22023', 'REVIEW_CHECKLIST_INCOMPLETE', 'the resubmission needs the full checklist again');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('ca-more'), 'approved', null, true, true) $$,
  'the resubmitted application is approved');
reset role;
select is((select array_agg(decision order by created_at) from public.coach_application_decisions where coach_profile_id = pg_temp.pid('ca-more')),
  array['submitted', 'changes_requested', 'submitted', 'approved'], 'its history tells the whole story, in order');
select pg_temp.anonymous();
select ok(pg_temp.exposed('ca-more'), 'and only now is it public');
reset role;

select * from finish();
rollback;
