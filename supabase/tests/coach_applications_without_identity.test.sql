-- pgTAP · Coach applications without identity documents (20261119100000)
--
-- Voinic does not collect identity documents. What must hold:
--   * an application is reviewed and approved with no identity document at all;
--   * required professional-qualification evidence is still enforced, per
--     declared discipline (or its parent), and an admin still has to approve;
--   * nobody but an admin decides, and the checklist is profile + qualifications;
--   * no identity document can be added, accepted or approved on; one left from
--     before can always be removed by its owner;
--   * no identity verification is recorded or shown publicly.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_applications_without_identity

begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
create or replace function pg_temp.uid(n int) returns uuid language sql as $fn$
  select ('cb000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$fn$;
create temp table ids (slug text primary key, id uuid);
grant select on ids to anon, authenticated;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$
  select id from ids where slug = p_slug;
$fn$;

-- 01 boxing coach (no evidence required) · 02 vinyasa coach (yoga requires evidence) · 03 legacy identity document
-- · 04 legacy identity verification · c1 a client · ad an admin
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.uid(n), u || '@cb.local', json_build_object('full_name', 'Noid ' || u, 'username', u)::jsonb
from (values (1, 'cb_box'), (2, 'cb_vinyasa'), (3, 'cb_oldid'), (4, 'cb_oldver')) v(n, u);
insert into auth.users (id, email, raw_user_meta_data) values
  ('cb000000-0000-0000-0000-0000000000c1', 'client@cb.local', '{"full_name":"Client","username":"cb_client"}'),
  ('cb000000-0000-0000-0000-0000000000ad', 'admin@cb.local', '{"full_name":"Admin","username":"cb_admin"}');
update public.users set role = 'admin' where id = 'cb000000-0000-0000-0000-0000000000ad';
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/a.jpg' where id::text like 'cb000000-%';

do $$
declare n int;
begin
  for n in 1..4 loop
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(n)::text, 'role', 'authenticated')::text, true);
    perform public.become_coach();
  end loop;
end;
$$;
insert into ids select slug, id from public.coach_profiles where user_id::text like 'cb000000-%';
update public.coach_profiles set headline = 'Coach', about = 'Classes.', online = true, accepting_clients = true
 where user_id::text like 'cb000000-%';
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, true from public.coach_profiles cp, public.specializations s
 where s.slug = case cp.slug when 'cb-vinyasa' then 'vinyasa-yoga' else 'boxing' end and cp.user_id::text like 'cb000000-%';
insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit)
select id, 'Class', 'online_coaching', 5000, 'session' from public.coach_profiles where user_id::text like 'cb000000-%';
-- yoga needs proof of qualification; vinyasa (a yoga style) inherits that; boxing keeps the default ('recommended')
update public.specializations set qualification_evidence = 'required' where slug = 'yoga';
update public.specializations set qualification_evidence = 'recommended' where slug in ('vinyasa-yoga', 'boxing');

-- ============================================================================
-- 1. no identity document needed, none accepted
-- ============================================================================
select pg_temp.authenticate_as(pg_temp.uid(1));
select throws_ok($$ select public.coach_add_verification_document('identity', 'voinic/coach-docs/' || auth.uid() || '/idcard00001', 'pdf', 1000) $$,
  '22023', 'IDENTITY_DOCUMENTS_NOT_ACCEPTED', 'an identity document cannot be added');
select throws_ok($$ insert into public.coach_verification_documents (coach_profile_id, kind, storage_public_id, format, bytes)
                    select id, 'identity', 'voinic/coach-docs/' || auth.uid() || '/idcard00001', 'pdf', 1 from public.coach_profiles where user_id = auth.uid() $$,
  '42501', null, 'nor written directly');
select is(public.coach_my_application() -> 'missing', '[]'::jsonb, 'a coach in a discipline with no required evidence needs no document at all');
select is(public.submit_coach_for_review(), '{}'::text[], 'and submits with no document on file');
select is((select count(*)::int from public.coach_verification_documents), 0, '… none was stored');
reset role;
-- the constraint is there for anything that gets around the function, the owner of the tables included
select throws_ok($$ insert into public.coach_verification_documents (coach_profile_id, kind, storage_public_id, format, bytes)
                    values (pg_temp.pid('cb-box'), 'identity', 'voinic/coach-docs/cb000000-0000-0000-0000-000000000001/idcard00002', 'pdf', 1) $$,
  '23514', null, 'no new identity document row, whoever inserts it');

-- ============================================================================
-- 2. only an admin decides; the checklist is profile + qualifications
-- ============================================================================
select pg_temp.authenticate_as(pg_temp.uid(1));
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cb-box'), 'approved', null, true, true) $$,
  '42501', 'ADMIN_ONLY', 'a coach cannot approve themselves');
select throws_ok($$ update public.coach_application_decisions set decision = 'approved' $$, '42501', null, 'nor rewrite a decision');
select throws_ok($$ update public.coach_profiles set review_decision = null, status = 'published' where user_id = auth.uid() $$,
  '42501', null, 'nor their review outcome or status');
reset role;
select pg_temp.authenticate_as('cb000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cb-box'), 'approved', null, true, true) $$,
  '42501', 'ADMIN_ONLY', 'a client cannot approve');
reset role;

select pg_temp.authenticate_as('cb000000-0000-0000-0000-0000000000ad');
select throws_ok($$ select public.admin_decide_coach_application(p_profile => pg_temp.pid('cb-box'), p_decision => 'approved',
                      p_identity_reviewed => true, p_qualifications_reviewed => true) $$,
  '42883', null, 'the identity-document box is gone from the decision');
select throws_ok($$ select public.admin_decide_coach_application(p_profile => pg_temp.pid('cb-box'), p_decision => 'approved',
                      p_qualifications_reviewed => true) $$,
  '22023', 'REVIEW_CHECKLIST_INCOMPLETE', 'approval still needs the profile reviewed');
select throws_ok($$ select public.admin_decide_coach_application(p_profile => pg_temp.pid('cb-box'), p_decision => 'approved',
                      p_profile_reviewed => true) $$,
  '22023', 'REVIEW_CHECKLIST_INCOMPLETE', '… and the qualifications reviewed');
select lives_ok($$ select public.admin_decide_coach_application(p_profile => pg_temp.pid('cb-box'), p_decision => 'approved',
                      p_profile_reviewed => true, p_qualifications_reviewed => true) $$,
  'an application with no identity document is approved by an admin');
select is((select status from public.coach_profiles where slug = 'cb-box'), 'published', '… and goes public');
select ok((select profile_reviewed and qualifications_reviewed and not identity_reviewed and actor_id = 'cb000000-0000-0000-0000-0000000000ad'
             from public.coach_application_decisions where coach_profile_id = pg_temp.pid('cb-box') and decision = 'approved'),
  'the decision records the reviewer and the two boxes, never an identity review');
select is((select count(*)::int from public.coach_verifications where coach_profile_id = pg_temp.pid('cb-box')), 0,
  'approval records no identity verification (and, with no qualification accepted, no certification either)');
reset role;

-- ============================================================================
-- 3. required qualification evidence, per declared discipline
-- ============================================================================
select pg_temp.authenticate_as(pg_temp.uid(2));
select is(public.submit_coach_for_review(), array['QUALIFICATION_DOCUMENT'], 'a style of a discipline that requires evidence requires it too');
select is(public.coach_my_application() -> 'missing_specializations', '["vinyasa-yoga"]'::jsonb, '… and the coach is told which');
select lives_ok($$ select public.coach_add_verification_document('other', 'voinic/coach-docs/' || auth.uid() || '/other000001', 'pdf', 1000, 'CV') $$,
  'another document can be added');
select is(public.submit_coach_for_review(), array['QUALIFICATION_DOCUMENT'], '… but does not count as a qualification');
select lives_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/cert0000001', 'pdf', 1000, 'Yoga teacher 200h') $$,
  'a qualification not tied to a discipline can be added');
select is(public.submit_coach_for_review(), array['QUALIFICATION_DOCUMENT'], '… but does not evidence the discipline');
select lives_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/cert0000002', 'pdf', 1000, 'Vinyasa', 'vinyasa-yoga') $$,
  'a qualification tagged with the declared discipline');
select is(public.submit_coach_for_review(), '{}'::text[], '… evidences it: submitted, no identity document anywhere');
reset role;
select pg_temp.authenticate_as('cb000000-0000-0000-0000-0000000000ad');
-- the qualification is judged not good enough: approval is refused until there is another
select lives_ok($$ select public.admin_set_verification_document_status(
    (select id from public.coach_verification_documents where storage_public_id like '%/cert0000002'), 'rejected', 'Illegible.') $$,
  'the admin marks the qualification as not accepted');
select throws_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cb-vinyasa'), 'approved', null, true, true) $$,
  '22023', 'APPLICATION_INCOMPLETE: QUALIFICATION_DOCUMENT', 'an admin cannot approve without the required qualification');
select lives_ok($$ select public.admin_set_verification_document_status(
    (select id from public.coach_verification_documents where storage_public_id like '%/cert0000002'), 'submitted') $$,
  '… and reopens it after a second look');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cb-vinyasa'), 'approved', null, true, true) $$,
  'with it, the admin approves');
select is((select array_agg(kind || ':' || status order by kind) from public.coach_verifications where coach_profile_id = pg_temp.pid('cb-vinyasa')),
  array['certification:verified'], 'the accepted qualification is recorded as such, separately from any identity');
reset role;

-- ============================================================================
-- 4. what is left from before: an identity document, an identity verification
-- ============================================================================
-- as an older database could hold them (the check is NOT VALID: it never touched old rows)
alter table public.coach_verification_documents drop constraint coach_verification_documents_no_identity;
insert into public.coach_verification_documents (coach_profile_id, kind, storage_public_id, format, bytes)
values (pg_temp.pid('cb-oldid'), 'identity', 'voinic/coach-docs/cb000000-0000-0000-0000-000000000003/idcard00001', 'pdf', 5000);
alter table public.coach_verification_documents
  add constraint coach_verification_documents_no_identity check (kind <> 'identity') not valid;
update public.coach_profiles set status = 'pending_review', submitted_at = now() where slug = 'cb-oldid';

select pg_temp.authenticate_as('cb000000-0000-0000-0000-0000000000ad');
select throws_ok($$ select public.admin_set_verification_document_status(
    (select id from public.coach_verification_documents where kind = 'identity'), 'accepted') $$,
  '22023', 'IDENTITY_DOCUMENTS_NOT_ACCEPTED', 'an old identity document cannot be accepted');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cb-oldid'), 'approved', null, true, true) $$,
  'the application is decided without it');
select is((select status from public.coach_verification_documents where kind = 'identity' and coach_profile_id = pg_temp.pid('cb-oldid')),
  'submitted', 'approval does not accept the identity document');
select is((select count(*)::int from public.coach_verifications where coach_profile_id = pg_temp.pid('cb-oldid') and kind = 'identity'),
  0, 'nor record an identity verification from it');
select throws_ok($$ select public.admin_set_coach_verification(pg_temp.pid('cb-oldver'), 'identity', 'verified') $$,
  '22023', 'IDENTITY_VERIFICATION_NOT_OFFERED', 'no identity verification can be recorded: there is no procedure behind one');
select lives_ok($$ select public.admin_set_coach_verification(pg_temp.pid('cb-oldver'), 'certification', 'verified') $$,
  'a certification check still can');
reset role;
select pg_temp.authenticate_as(pg_temp.uid(3));
select is(public.coach_remove_verification_document((select id from public.coach_verification_documents where kind = 'identity')),
  'voinic/coach-docs/cb000000-0000-0000-0000-000000000003/idcard00001',
  'its owner removes the old identity document whenever they like (the server then deletes the file)');
reset role;

-- an identity verification recorded before, on a Voinic Verified, public coach: kept, never shown
insert into public.coach_verifications (coach_profile_id, kind, status, verified_at)
values (pg_temp.pid('cb-oldver'), 'identity', 'verified', now() - interval '30 days');
update public.coach_profiles set status = 'published', published_at = now(), verification_status = 'verified' where slug = 'cb-oldver';
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.coach_public_profile('cb-oldver') -> 'badges', '["certification_verified"]'::jsonb,
  'the public page shows the certification check and no identity badge');
select is(public.coach_public_profile('cb-oldver') ->> 'verified', 'true', '… the Voinic Verified decision itself unchanged');
reset role;
select is((select count(*)::int from public.coach_verifications where coach_profile_id = pg_temp.pid('cb-oldver') and kind = 'identity'),
  1, 'the old row is history: kept, not deleted');

-- a coach declaring a discipline and one of its styles: a qualification tagged with the style does not
-- evidence the discipline itself; one tagged with the discipline evidences both
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select pg_temp.pid('cb-oldver'), id, false from public.specializations where slug in ('yoga', 'hatha-yoga');
update public.coach_profiles set status = 'draft' where slug = 'cb-oldver';
select pg_temp.authenticate_as(pg_temp.uid(4));
select lives_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/hatha000001', 'pdf', 1000, 'Hatha', 'hatha-yoga') $$,
  'a qualification for the style');
select is(public.coach_my_application() -> 'missing_specializations', '["yoga"]'::jsonb, '… leaves the discipline itself without evidence');
select lives_ok($$ select public.coach_add_verification_document('qualification', 'voinic/coach-docs/' || auth.uid() || '/yoga000001', 'pdf', 1000, 'Yoga', 'yoga') $$,
  'a qualification for the discipline');
select is(public.coach_my_application() -> 'missing', '[]'::jsonb, '… evidences the discipline and its style');
reset role;

select * from finish();
rollback;
