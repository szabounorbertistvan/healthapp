-- pgTAP · Coach documents: operations (20261120100000)
--
-- A revision cannot publish a discipline that needs a qualification without
-- the evidence (and the coach can provide it before the change is approved);
-- the notices that were missing; and the cleanup script's functions: service
-- role only, identity mode touches identity rows only, retention mode only
-- evidence nobody needs, a purge deletes only a row that is still a candidate
-- and still names the same file, and running it twice changes nothing more.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_documents_operations

begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
create or replace function pg_temp.uid(n int) returns uuid language sql as $fn$
  select ('cd000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$fn$;
create temp table ids (slug text primary key, id uuid);
grant select on ids to anon, authenticated, service_role;
create or replace function pg_temp.pid(p_slug text) returns uuid language sql as $fn$
  select id from ids where slug = p_slug;
$fn$;
create or replace function pg_temp.path(n int, p_name text) returns text language sql as $fn$
  select 'voinic/coach-docs/' || pg_temp.uid(n) || '/' || p_name;
$fn$;
-- a document's id by its exact file name (read as the owner of the tables, whatever the session's role)
create temp table docs (path text primary key, id uuid);
grant select on docs to anon, authenticated, service_role;
create or replace function pg_temp.doc(n int, p_name text) returns uuid language sql as $fn$
  select id from docs where path = pg_temp.path(n, p_name);
$fn$;

-- 01 live (approved) · 02 live with old evidence · 03 revoked long ago · 04 in review · 05 identity leftover · ad admin · c1 client
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.uid(n), u || '@cd.local', json_build_object('full_name', 'Ops ' || u, 'username', u)::jsonb
from (values (1, 'cd_live'), (2, 'cd_old'), (3, 'cd_revoked'), (4, 'cd_review'), (5, 'cd_identity')) v(n, u);
insert into auth.users (id, email, raw_user_meta_data) values
  ('cd000000-0000-0000-0000-0000000000ad', 'admin@cd.local', '{"full_name":"Admin","username":"cd_admin"}'),
  ('cd000000-0000-0000-0000-0000000000c1', 'client@cd.local', '{"full_name":"Client","username":"cd_client"}');
update public.users set role = 'admin' where id = 'cd000000-0000-0000-0000-0000000000ad';
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/a.jpg' where id::text like 'cd000000-%';
do $$
declare n int;
begin
  for n in 1..5 loop
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(n)::text, 'role', 'authenticated')::text, true);
    perform public.become_coach();
  end loop;
end;
$$;
insert into ids select slug, id from public.coach_profiles where user_id::text like 'cd000000-%';
update public.coach_profiles set headline = 'Coach', about = 'Classes.', online = true, accepting_clients = true
 where user_id::text like 'cd000000-%';
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, true from public.coach_profiles cp, public.specializations s
 where s.slug = 'boxing' and cp.user_id::text like 'cd000000-%';
insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit)
select id, 'Class', 'online_coaching', 5000, 'session' from public.coach_profiles where user_id::text like 'cd000000-%';
update public.specializations set qualification_evidence = 'required' where slug = 'yoga';
update public.specializations set qualification_evidence = 'recommended' where slug = 'boxing';

-- documents, as each coach adds them while their profile is a draft
do $$
declare n int;
begin
  for n in 2..4 loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(n)::text, 'role', 'authenticated')::text, true);
    perform public.coach_add_verification_document('qualification', pg_temp.path(n, 'cert0000001'), 'pdf', 1000, 'Boxing coach', 'boxing');
    perform public.coach_add_verification_document('other', pg_temp.path(n, 'other000001'), 'pdf', 1000, 'CV');
    reset role;
  end loop;
end;
$$;
-- every application submitted
do $$
declare n int;
begin
  for n in 1..4 loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(n)::text, 'role', 'authenticated')::text, true);
    perform public.submit_coach_for_review();
    reset role;
  end loop;
end;
$$;

insert into docs select storage_public_id, id from public.coach_verification_documents where storage_public_id like '%cd000000-%';

-- ============================================================================
-- 1. notices: admins hear of a submission; the coach hears of a document not accepted
-- ============================================================================
select is((select count(*)::int from public.notifications where user_id = 'cd000000-0000-0000-0000-0000000000ad'
            and payload ->> 'event' = 'admin_application_submitted'), 4, 'every submission reaches the admin');
select is((select count(*)::int from public.notifications where user_id = 'cd000000-0000-0000-0000-0000000000c1'
            and payload ->> 'event' = 'admin_application_submitted'), 0, '… and nobody else');
select is((select payload ->> 'screen' from public.notifications where user_id = 'cd000000-0000-0000-0000-0000000000ad'
            and payload ->> 'event' = 'admin_application_submitted' limit 1), 'admin_coach_applications', '… pointing at the queue');

-- decisions: 1, 2, 3 approved; 4 stays in review
select pg_temp.authenticate_as('cd000000-0000-0000-0000-0000000000ad');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cd-live'), 'approved', null, true, true) $$, 'cd-live approved');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cd-old'), 'approved', null, true, true) $$, 'cd-old approved');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cd-revoked'), 'approved', null, true, true) $$, 'cd-revoked approved …');
select lives_ok($$ select public.admin_decide_coach_application(pg_temp.pid('cd-revoked'), 'revoked', 'Left the platform.') $$, '… then revoked');
reset role;
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid(3) and payload ->> 'event' = 'profile_unpublished'),
  1, 'the revoked coach is told');
select is(public.email_rule_delay_minutes('marketplace', 'profile_unpublished'), 0, '… and a revocation is emailed now');
select pg_temp.authenticate_as('cd000000-0000-0000-0000-0000000000ad');
select lives_ok($$ select public.admin_set_verification_document_status(pg_temp.doc(4, 'other000001'), 'rejected', 'Expired.') $$,
  'an admin does not accept a document');
reset role;
select is((select count(*)::int from public.notifications where user_id = pg_temp.uid(4) and payload ->> 'event' = 'document_not_accepted'),
  1, 'the coach is told a document was not accepted');
select is(public.email_rule_delay_minutes('marketplace', 'document_not_accepted'), 0, '… by email too');
select is((select count(*)::int from public.notifications where user_id::text like 'cd000000-%'
            and (body ~* '(pdf|coach-docs|cert0)' or payload::text ~* '(coach-docs|storage_public_id|cert0)')), 0,
  'no notice names a document or its file');

-- ============================================================================
-- 2. a revision cannot add a discipline that needs evidence without it
-- ============================================================================
select pg_temp.authenticate_as(pg_temp.uid(1));
select lives_ok($$ select public.coach_revision_save(jsonb_set(public.coach_revision_start(), '{specializations}',
                     (public.coach_revision_start() -> 'specializations') || '[{"slug": "yoga", "is_primary": false}]'::jsonb)) $$,
  'a live coach adds yoga (evidence required) in a revision');
select is(public.coach_revision_submit(), '{}'::text[], '… and submits it');
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-0000000000ad');
select throws_ok($$ select public.admin_decide_coach_revision(pg_temp.pid('cd-live'), true) $$,
  '22023', 'APPLICATION_INCOMPLETE: QUALIFICATION_DOCUMENT', 'the admin cannot approve it without the qualification');
reset role;
select is((select array_agg(s.slug order by s.slug) from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
            where cs.coach_profile_id = pg_temp.pid('cd-live')), array['boxing'], 'nothing of the refused approval was applied');
select is((select status from public.coach_profile_revisions where coach_profile_id = pg_temp.pid('cd-live')), 'pending_review',
  'the revision is still waiting');
select pg_temp.authenticate_as(pg_temp.uid(1));
select lives_ok($$ select public.coach_add_verification_document('qualification', pg_temp.path(1, 'yoga0000001'), 'pdf', 1000, 'Yoga 200h', 'yoga') $$,
  'the coach can tag a qualification with the discipline their revision adds');
select throws_ok($$ select public.coach_add_verification_document('qualification', pg_temp.path(1, 'pilates0001'), 'pdf', 1000, 'Pilates', 'pilates') $$,
  '22023', 'UNKNOWN_SPECIALIZATION', '… but not with one they declare nowhere');
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-0000000000ad');
select lives_ok($$ select public.admin_decide_coach_revision(pg_temp.pid('cd-live'), true) $$, 'with the evidence, the revision is approved');
reset role;
select is((select array_agg(s.slug order by s.slug) from public.coach_specializations cs join public.specializations s on s.id = cs.specialization_id
            where cs.coach_profile_id = pg_temp.pid('cd-live')), array['boxing', 'yoga'], 'and the discipline is live');

-- ============================================================================
-- 3. the cleanup functions: service role only
-- ============================================================================
-- a leftover identity document, as an older database could hold it
alter table public.coach_verification_documents drop constraint coach_verification_documents_no_identity;
insert into public.coach_verification_documents (coach_profile_id, kind, storage_public_id, format, bytes)
values (pg_temp.pid('cd-identity'), 'identity', pg_temp.path(5, 'idcard00001'), 'pdf', 5000);
alter table public.coach_verification_documents
  add constraint coach_verification_documents_no_identity check (kind <> 'identity') not valid;
insert into docs select storage_public_id, id from public.coach_verification_documents where storage_public_id like '%cd000000-%'
on conflict (path) do nothing;
-- time passes: decisions and documents a year old
update public.coach_verification_documents set created_at = now() - interval '400 days', reviewed_at = now() - interval '400 days'
 where coach_profile_id in (pg_temp.pid('cd-old'), pg_temp.pid('cd-revoked'), pg_temp.pid('cd-review'));
update public.coach_profiles set reviewed_at = now() - interval '400 days' where slug in ('cd-revoked', 'cd-old');

select pg_temp.authenticate_as('cd000000-0000-0000-0000-0000000000ad');
select throws_ok($$ select * from public.coach_document_purge_candidates('identity') $$, '42501', null, 'an admin session cannot list purge candidates');
select throws_ok($$ select public.coach_document_purge(pg_temp.doc(5, 'idcard00001'), pg_temp.path(5, 'idcard00001'), 'identity') $$,
  '42501', null, 'nor purge');
select throws_ok($$ select * from public.coach_document_storage_ids() $$, '42501', null, 'nor list stored files');
reset role;
select pg_temp.authenticate_as(pg_temp.uid(5));
select throws_ok($$ select public.coach_document_purge(pg_temp.doc(5, 'idcard00001'), pg_temp.path(5, 'idcard00001'), 'identity') $$,
  '42501', null, 'a coach cannot purge either');
reset role;
select set_config('role', 'anon', true);
select throws_ok($$ select * from public.coach_document_purge_candidates('identity') $$, '42501', null, 'nor an anonymous caller');
reset role;

set local role service_role;
select is((select array_agg(reason) from public.coach_document_purge_candidates('identity')), array['identity_document'],
  'identity mode: exactly the identity document');
select is((select coach_user_id from public.coach_document_purge_candidates('identity')), pg_temp.uid(5), '… with its owner, to check the folder');
select throws_ok($$ select * from public.coach_document_purge_candidates('retention', 7) $$, '22023', 'RETENTION_DAYS_TOO_SHORT',
  'retention refuses a window under 30 days');
select throws_ok($$ select * from public.coach_document_purge_candidates('everything') $$, '22023', 'BAD_MODE', 'an unknown mode is refused');
select is((select array_agg(c.storage_public_id order by c.storage_public_id) from public.coach_document_purge_candidates('retention', 180) c),
  array[pg_temp.path(3, 'cert0000001'), pg_temp.path(3, 'other000001')],
  'retention: the revoked application''s evidence only — not live evidence, not a document in review, not identity');
select is((select count(*)::int from public.coach_document_purge_candidates('retention', 500)), 0, 'nothing is old enough for a 500-day rule');

-- a purge deletes only a row still a candidate, still naming the same file
select is(public.coach_document_purge(pg_temp.doc(2, 'cert0000001'), pg_temp.path(2, 'cert0000001'), 'identity'), false,
  'a qualification cannot be purged as an identity document');
select is(public.coach_document_purge(pg_temp.doc(5, 'idcard00001'), pg_temp.path(5, 'idcard00002'), 'identity'), false,
  'nor a row whose file name does not match');
select is(public.coach_document_purge(pg_temp.doc(2, 'cert0000001'),
                                      pg_temp.path(2, 'cert0000001'), 'retention', 180), false,
  'evidence a live profile was approved on is never a retention candidate');
select is(public.coach_document_purge(pg_temp.doc(5, 'idcard00001'), pg_temp.path(5, 'idcard00001'), 'identity'), true,
  'the identity document row goes (after its file)');
select is(public.coach_document_purge(pg_temp.doc(5, 'idcard00001'),
                                      pg_temp.path(5, 'idcard00001'), 'identity'), false, 'a second run finds nothing more to do');
select is((select count(*)::int from public.coach_document_purge_candidates('identity')), 0, 'no identity candidates left');
select is((select count(*)::int from public.coach_document_storage_ids()), 7, 'every other file stays on record');
reset role;
select is((select count(*)::int from public.coach_verification_documents where kind = 'qualification'), 4, 'no qualification row was touched');
select ok(exists (select 1 from public.admin_audit_events where metadata ->> 'op' = 'document_purge' and metadata ->> 'mode' = 'identity'),
  'the purge is audited');
select is((select count(*)::int from public.admin_audit_events where metadata ->> 'op' = 'document_purge' and metadata::text ~ 'coach-docs'),
  0, '… without the file name');

select * from finish();
rollback;
