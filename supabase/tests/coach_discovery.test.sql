-- pgTAP · Coach Discovery foundation (20261020100000)
--
-- The part that matters most is section 4: coach_public_profile() is the first
-- function in this database an anonymous caller may run, and it must return a
-- published profile's public fields and nothing else — no draft, pending or
-- suspended profile, no e-mail, no document_ref, no admin or moderation data,
-- no private price.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_discovery

begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

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

-- 01 the coach-to-be (a client; full_name is an e-mail, as sign-up leaves it)
-- 02 a client · 03 an admin · 04 a coach left in draft · 05 one left pending
-- 06 one suspended · 07 one published whose ACCOUNT gets suspended · 08 a stranger
insert into auth.users (id, email, raw_user_meta_data) values
  ('cd000000-0000-0000-0000-000000000001', 'andrei@coach.local',  '{"full_name":"andrei@coach.local","username":"andrei.pop"}'),
  ('cd000000-0000-0000-0000-000000000002', 'cora@coach.local',    '{"full_name":"Cora Client","username":"cora_client"}'),
  ('cd000000-0000-0000-0000-000000000003', 'admin@coach.local',   '{"full_name":"Admin","username":"admin_coach"}'),
  ('cd000000-0000-0000-0000-000000000004', 'dan@coach.local',     '{"full_name":"Dan Draft","username":"dan_draft"}'),
  ('cd000000-0000-0000-0000-000000000005', 'paula@coach.local',   '{"full_name":"Paula Pending","username":"paula_pending"}'),
  ('cd000000-0000-0000-0000-000000000006', 'sam@coach.local',     '{"full_name":"Sam Suspended","username":"sam_suspended"}'),
  ('cd000000-0000-0000-0000-000000000007', 'ursu@coach.local',    '{"full_name":"Ursu","username":"ursu_banned"}'),
  ('cd000000-0000-0000-0000-000000000008', 'stefan@coach.local',  '{"full_name":"Stefan","username":"stefan_x"}');
update public.users set role = 'admin' where id = 'cd000000-0000-0000-0000-000000000003';
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/a.jpg'
 where id in ('cd000000-0000-0000-0000-000000000005', 'cd000000-0000-0000-0000-000000000006',
              'cd000000-0000-0000-0000-000000000007');

-- ============================================================================
-- 1. become_coach
-- ============================================================================
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.become_coach() $$, 'a client can become a coach');
select is((select role::text from public.users where id = 'cd000000-0000-0000-0000-000000000001'),
  'both', 'a client becomes both, keeping their own client engines');
select is((select status from public.coach_profiles where user_id = 'cd000000-0000-0000-0000-000000000001'),
  'draft', 'the profile starts as a draft');
select is((select slug from public.coach_profiles where user_id = 'cd000000-0000-0000-0000-000000000001'),
  'andrei-pop', 'the slug comes from the username');
select is(public.become_coach(),
  (select id from public.coach_profiles where user_id = 'cd000000-0000-0000-0000-000000000001'),
  'become_coach is idempotent');
-- own_tier() reads coach_free for a coach role (coach_pro while a new account's trial runs)
select ok(public.own_tier('cd000000-0000-0000-0000-000000000001') in ('coach_free', 'coach_pro'),
  'the tier follows the role: a coach tier');

reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.become_coach() $$, 'an admin may also have a coach profile');
select is((select role::text from public.users where id = 'cd000000-0000-0000-0000-000000000003'),
  'admin', 'become_coach never changes an admin''s role');

reset role;
select pg_temp.anonymous();
select throws_ok($$ select public.become_coach() $$, '42501', null, 'an anonymous caller cannot become a coach');

-- ============================================================================
-- 2. drafts and the lifecycle
-- ============================================================================
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ update public.coach_profiles set status = 'published' where user_id = auth.uid() $$,
  '42501', null, 'a coach cannot write their own status');
select throws_ok(
  $$ insert into public.coach_profiles (user_id, slug) values (auth.uid(), 'second-profile') $$,
  '42501', null, 'a profile cannot be inserted directly');
select throws_ok(
  $$ update public.coach_profiles set slug = 'cluj-napoca' where user_id = auth.uid() $$,
  '22023', 'SLUG_RESERVED', 'a city slug cannot be a coach slug');
select throws_ok(
  $$ update public.coach_profiles set slug = 'Not A Slug' where user_id = auth.uid() $$,
  '23514', null, 'a malformed slug is refused');

select ok(
  public.submit_coach_for_review() @> array['HEADLINE', 'ABOUT', 'SPECIALIZATION', 'DELIVERY_MODE', 'SERVICE', 'AVATAR'],
  'an empty draft lists everything that is missing');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'draft',
  'an incomplete draft stays a draft');

-- fill it in, step by step, as the editor will
select lives_ok($$ update public.coach_profiles
  set headline = 'Hypertrophy coach', about = 'Ten years of coaching.', coaching_since = 2015,
      in_person = true, online = true
  where user_id = auth.uid() $$, 'the coach saves the text fields of a draft');
select lives_ok($$ select public.coach_set_specializations(array['hypertrophy', 'strength'], 'hypertrophy') $$,
  'the coach picks specializations');
select throws_ok($$ select public.coach_set_specializations(array['underwater-yoga']) $$,
  '22023', 'UNKNOWN_SPECIALIZATION', 'an unknown specialization is refused');
select lives_ok($$ select public.coach_set_languages(array['ro', 'en']) $$, 'the coach picks languages');
select throws_ok($$ select public.coach_set_languages(array['xx']) $$,
  '22023', 'UNKNOWN_LANGUAGE', 'an unknown language is refused');
select ok('LOCATION' = any (public.coach_profile_missing()), 'in person without a city is still missing a location');
select lives_ok($$ select public.coach_set_locations('[{"city":"cluj-napoca","gym_name":"Iron Gym"}]') $$,
  'the coach picks a city');
select throws_ok($$ select public.coach_set_locations('[{"city":"atlantis"}]') $$,
  '22023', 'UNKNOWN_CITY', 'an unknown city is refused');
select lives_ok($$ insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit)
  select id, 'Online coaching', 'online_coaching', 40000, 'month' from public.coach_profiles where user_id = auth.uid() $$,
  'the coach adds a public-priced service');
select lives_ok($$ insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit, price_public)
  select id, 'VIP 1:1', 'personal_training', 987654, 'session', false from public.coach_profiles where user_id = auth.uid() $$,
  'the coach adds a service with a private price');
select lives_ok($$ insert into public.coach_certifications (coach_profile_id, name, issuer, year)
  select id, 'ISSA CPT', 'ISSA', 2016 from public.coach_profiles where user_id = auth.uid() $$,
  'the coach adds a certification');
select throws_ok($$ insert into public.coach_certifications (coach_profile_id, name, verification_status)
  select id, 'Self-verified', 'verified' from public.coach_profiles where user_id = auth.uid() $$,
  '42501', null, 'a coach cannot mark their own certification verified');
select throws_ok($$ select document_ref from public.coach_certifications $$,
  '42501', null, 'document_ref is not readable through the API, not even by the owner');
select is(public.coach_profile_missing(), array['AVATAR'], 'only the profile photo is missing now');

update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/andrei.jpg' where id = auth.uid();
select is(public.submit_coach_for_review(), '{}'::text[], 'a complete draft is submitted');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'pending_review',
  'draft → pending_review');
select throws_ok($$ update public.coach_profiles set headline = 'Changed after submitting' where user_id = auth.uid() $$,
  '55000', 'PROFILE_LOCKED', 'content is locked once submitted');
select lives_ok($$ update public.coach_profiles set accepting_clients = true where user_id = auth.uid() $$,
  'accepting_clients stays switchable');
select throws_ok($$ insert into public.coach_services (coach_profile_id, name)
  select id, 'Sneaked in' from public.coach_profiles where user_id = auth.uid() $$,
  '42501', null, 'a service cannot be added to a submitted profile');
select throws_ok($$ select public.coach_set_languages(array['hu']) $$,
  '55000', 'PROFILE_LOCKED', 'the sets cannot change once submitted');

-- the private document reference an admin will one day set
reset role;
update public.coach_certifications set document_ref = 'vault://secret-doc-ref-42', admin_note = 'internal-cert-note'
 where name = 'ISSA CPT';

-- ============================================================================
-- 3. admin moderation and verification
-- ============================================================================
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.admin_set_coach_profile_status(
    (select id from public.coach_profiles where user_id = auth.uid()), 'published') $$,
  '42501', null, 'a coach cannot approve their own profile');

reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('andrei-pop'), null, 'a pending profile is invisible');

reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.admin_coach_profiles('pending_review')
           where slug = 'andrei-pop'), 1, 'the admin queue lists the pending profile');
select throws_ok($$ select public.admin_set_coach_profile_status(
    (select id from public.coach_profiles where slug = 'andrei-pop'), 'draft') $$,
  '22023', 'REASON_REQUIRED', 'a rejection needs a reason');
select lives_ok($$ select public.admin_set_coach_profile_status(
    (select id from public.coach_profiles where slug = 'andrei-pop'), 'published') $$,
  'an admin approves');
select ok((select published_at is not null from public.coach_profiles where slug = 'andrei-pop'),
  'published_at is stamped');
select lives_ok($$ select public.admin_set_coach_verification(
    (select id from public.coach_profiles where slug = 'andrei-pop'), 'identity', 'verified', 'internal-id-note') $$,
  'an admin verifies identity');
select lives_ok($$ select public.admin_set_coach_verification(
    (select id from public.coach_profiles where slug = 'andrei-pop'), 'business', 'pending') $$,
  'a pending business verification is recorded');
select lives_ok($$ select public.admin_set_certification_status(
    (select id from public.coach_certifications where name = 'ISSA CPT'), 'verified') $$,
  'an admin verifies a certification');
select ok(exists (select 1 from public.admin_audit_events
                  where action = 'ADMIN_ACTION' and metadata ->> 'op' = 'coach_profile_status'),
  'the approval is audited');

-- the search foundation (read as the owner: search_text is never served)
reset role;
-- Voinic Verified is the coach-level decision (20261101100000); the per-kind
-- badges checked below only show under it
update public.coach_profiles set verification_status = 'verified' where slug = 'andrei-pop';
select ok((select search_text like '%hypertrophy%' and search_text like '%hipertrofie%'
                  and search_text like '%cluj-napoca%' and search_text like '%online coaching%'
           from public.coach_profiles where slug = 'andrei-pop'),
  'search_text carries specializations (both languages), city and services, unaccented');
select ok((select position('@' in search_text) = 0 and search_doc @@ to_tsquery('simple', 'hypertrophy')
           from public.coach_profiles where slug = 'andrei-pop'),
  'search_text never carries the e-mail, and the tsvector matches');

-- the other coaches, put in place by the owner
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000004'); select public.become_coach();
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000005'); select public.become_coach();
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000006'); select public.become_coach();
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000007'); select public.become_coach();
reset role;
update public.coach_profiles set status = 'pending_review' where slug = 'paula-pending';
update public.coach_profiles set status = 'suspended', suspended_at = now(),
       suspension_reason = 'internal-suspension-reason' where slug = 'sam-suspended';
update public.coach_profiles set status = 'published', published_at = now() where slug = 'ursu-banned';
update public.users set suspended_at = now() where id = 'cd000000-0000-0000-0000-000000000007';
create temp table coach_ids as select slug, id from public.coach_profiles;
grant select on coach_ids to authenticated, anon;

-- ============================================================================
-- 4. the public door, as an anonymous visitor
-- ============================================================================
select pg_temp.anonymous();
select ok(public.coach_public_profile('andrei-pop') is not null, '1. a published profile is visible');
select is(public.coach_public_profile('andrei-pop') ->> 'display_name', 'andrei.pop',
  'the public name is the username');
select is(public.coach_public_profile('dan-draft'), null, '2. a draft profile is invisible');
select is(public.coach_public_profile('paula-pending'), null, '3. a pending profile is invisible');
select is(public.coach_public_profile('sam-suspended'), null, '4. a suspended profile is invisible');
select is(public.coach_public_profile('ursu-banned'), null, 'a published profile of a suspended account is invisible');
select ok(position('@' in public.coach_public_profile('andrei-pop')::text) = 0,
  '5. no e-mail address anywhere in the payload');
select ok(position('secret-doc-ref' in public.coach_public_profile('andrei-pop')::text) = 0
          and position('document_ref' in public.coach_public_profile('andrei-pop')::text) = 0,
  '6. document_ref is never returned');
select ok(not (public.coach_public_profile('andrei-pop') ?| array[
            'status', 'review_note', 'suspension_reason', 'suspended_at', 'reviewed_by', 'submitted_at',
            'rank_score', 'search_text', 'search_doc', 'email', 'full_name', 'admin_note']),
  '7. no status, moderation or internal key is returned');
select ok(position('internal-' in public.coach_public_profile('andrei-pop')::text) = 0,
  '7. no admin note reaches the payload');
select ok(position('987654' in public.coach_public_profile('andrei-pop')::text) = 0,
  '7. a private price is never returned');
select is(public.coach_public_profile('andrei-pop') -> 'user_id', 'null'::jsonb,
  'an anonymous visitor does not get the user id');
select is(public.coach_public_profile('cora-client'), null, '8. a user without a coach profile produces nothing');
select is(public.coach_public_profile($q$' or 1=1 --$q$), null, '9. a hostile slug produces nothing');
select is(public.coach_public_profile(null), null, '9. a null slug produces nothing');
select is(public.coach_public_profile('andrei-pop') -> 'badges', '["identity_verified"]'::jsonb,
  'only the approved verification is a badge (identity yes, pending business no)');
select is(public.coach_public_profile('andrei-pop') #>> '{certifications,0,verified}', 'true',
  'a verified certification carries its badge');
select is(jsonb_array_length(public.coach_public_profile('andrei-pop') -> 'services'), 2,
  'both active services are listed');
select throws_ok($$ select count(*) from public.coach_profiles $$, '42501', null,
  'anon cannot read coach_profiles directly');
select throws_ok($$ select count(*) from public.coach_certifications $$, '42501', null,
  'anon cannot read coach_certifications directly');
select throws_ok($$ select public.request_coaching('cd000000-0000-0000-0000-0000000000ff') $$, '42501', null,
  'anon cannot send a coaching request');

-- ============================================================================
-- 5. a signed-in stranger sees no more than the public
-- ============================================================================
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000008');
select is((select count(*)::int from public.coach_profiles), 0, 'a stranger reads no coach_profiles row');
select is((select count(*)::int from public.coach_verifications), 0, 'a stranger reads no verification row');
select ok(public.coach_public_profile('andrei-pop') ->> 'user_id' is not null,
  'a signed-in visitor gets the user id the buttons need');

-- ============================================================================
-- 6. coaching requests
-- ============================================================================
reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.request_coaching(
    (select id from coach_ids where slug = 'andrei-pop'), null, 'I want to get stronger') $$,
  'a client asks a published coach');
select throws_ok($$ select public.request_coaching(
    (select id from coach_ids where slug = 'andrei-pop')) $$,
  '23505', 'REQUEST_PENDING', 'one pending request per coach');
select throws_ok($$ select public.request_coaching(
    (select id from coach_ids where slug = 'dan-draft')) $$,
  'P0002', 'COACH_NOT_FOUND', 'a draft coach cannot be asked');
select throws_ok($$ select public.request_coaching(
    (select id from coach_ids where slug = 'ursu-banned')) $$,
  'P0002', 'COACH_NOT_FOUND', 'a coach whose account is suspended cannot be asked');
select is((select count(*)::int from public.coaching_requests), 1, 'the client reads their own request');

reset role;
create temp table request_ids as select id from public.coaching_requests;
grant select on request_ids to authenticated;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000008');
select is((select count(*)::int from public.coaching_requests), 0, 'a stranger reads no request');
select throws_ok($$ select public.decline_coaching_request((select id from request_ids)) $$,
  '55000', 'REQUEST_NOT_PENDING', 'a stranger cannot decline someone else''s request');

reset role;
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.decline_coaching_request(
    (select id from public.coaching_requests where status = 'pending' limit 1), 'Fully booked') $$,
  'the coach declines');
select is((select status from public.coaching_requests limit 1), 'declined', 'the request is declined');

-- withdraw: published → draft takes it off the public page
select lives_ok($$ select public.withdraw_coach_profile() $$, 'the coach withdraws the profile');
reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('andrei-pop'), null, 'a withdrawn profile is invisible again');

reset role;
select * from finish();
rollback;
