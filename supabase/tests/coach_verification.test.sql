-- pgTAP · Coach verification & trust signals (20261101100000)
--
-- "Voinic Verified" is one coach-level status an admin sets after the coach
-- asks. A complete profile or a credential never implies it; a coach can ask
-- but never decide; credentials are self-reported until an admin verifies
-- each; the public sees only "verified or not", never a pending or a refusal.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_verification

begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
create or replace function pg_temp.card_verified(p_query text) returns text language sql as $fn$
  select i ->> 'verified' from jsonb_array_elements(public.search_coaches(p_query => p_query, p_accepting => false) -> 'items') i;
$fn$;

-- 01 the coach · 02 another user · 03 an admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('c6000000-0000-0000-0000-000000000001'::uuid, 'vera@verif.local', '{"full_name":"Vera","username":"vera_verif"}'),
  ('c6000000-0000-0000-0000-000000000002'::uuid, 'mal@verif.local',  '{"full_name":"Mal","username":"mal_verif"}'),
  ('c6000000-0000-0000-0000-000000000003'::uuid, 'adm@verif.local',  '{"full_name":"Adm","username":"adm_verif"}');
update public.users set role = 'admin' where id = 'c6000000-0000-0000-0000-000000000003';

-- ============================================================================
-- 1. default: unverified, and asking needs a complete profile
-- ============================================================================
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000001');
select public.become_coach();
select is((select verification_status from public.coach_profiles where user_id = auth.uid()), 'unverified',
  'a new coach profile is unverified');
select ok(public.request_coach_verification('please') @> array['HEADLINE', 'AVATAR'],
  'an incomplete profile cannot ask for verification, and says what is missing');
select is((select verification_status from public.coach_profiles where user_id = auth.uid()), 'unverified', 'still unverified');

-- complete it, with two self-reported credentials
update public.coach_profiles set headline = 'Physio-minded coach', about = 'Rehab and strength.', online = true
 where user_id = auth.uid();
select public.coach_set_specializations(array['mobility'], 'mobility');
insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
select id, 'Online coaching', 30000, 'month' from public.coach_profiles where user_id = auth.uid();
select lives_ok($$ insert into public.coach_certifications (coach_profile_id, name, issuer, year, credential_number, expires_on)
  select id, 'NASM CPT', 'NASM', 2019, 'CPT-123456', date '2027-06-30' from public.coach_profiles where user_id = auth.uid() $$,
  'the coach adds a credential with a number and an expiry');
select lives_ok($$ insert into public.coach_certifications (coach_profile_id, name, issuer, year)
  select id, 'First aid', 'Red Cross', 2024 from public.coach_profiles where user_id = auth.uid() $$, 'and a second one');
select throws_ok($$ insert into public.coach_certifications (coach_profile_id, name, credential_number)
  select id, 'Blank number', '   ' from public.coach_profiles where user_id = auth.uid() $$,
  '23514', null, 'a blank credential number is refused');
select is((select count(*)::int from public.coach_certifications where verification_status = 'unverified'), 2,
  'credentials start self-reported (unverified)');
reset role;
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/vera.jpg'
 where id = 'c6000000-0000-0000-0000-000000000001';
create temp table ids as select id from public.coach_profiles where slug = 'vera-verif';
grant select on ids to authenticated, anon;

-- publish it (review), then look: complete and public is NOT verified
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000001');
select public.submit_coach_for_review();
reset role;
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000003');
select public.admin_set_coach_profile_status((select id from ids), 'published');
reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('vera-verif') ->> 'verified', 'false', 'a complete, published profile is not Voinic Verified');
select is(pg_temp.card_verified('vera'), 'false', 'nor is its search card');
select is((public.search_coaches(p_query => 'vera', p_verified => true, p_accepting => false) ->> 'total')::int, 0,
  'nor does it pass the verified filter');
select is((select count(*)::int from jsonb_array_elements(public.coach_public_profile('vera-verif') -> 'certifications') c
           where (c ->> 'verified')::boolean), 0, 'self-reported credentials are never marked verified');
select ok(position('CPT-123456' in public.coach_public_profile('vera-verif')::text) = 0,
  'a credential number never reaches the public page');
select is(public.coach_public_profile('vera-verif') #>> '{certifications,0,expires_on}', '2027-06-30',
  'the expiry does');
reset role;

-- ============================================================================
-- 2. the coach asks; nobody else can, and the coach cannot decide
-- ============================================================================
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000001');
select is(public.request_coach_verification('ID and NASM card ready on request'), '{}'::text[], 'the coach asks');
select is((select verification_status from public.coach_profiles where user_id = auth.uid()), 'pending', 'unverified → pending');
select is((select count(*)::int from public.coach_certifications where verification_status = 'pending'), 2,
  'their credentials are pending with it');
select throws_ok($$ select public.request_coach_verification() $$, '55000', 'BAD_TRANSITION', 'asking twice is refused');
select throws_ok($$ update public.coach_profiles set verification_status = 'verified' where user_id = auth.uid() $$,
  '42501', null, 'the coach cannot write their status');
select throws_ok($$ update public.coach_certifications set verification_status = 'verified' $$,
  '42501', null, 'nor a credential''s');
select throws_ok($$ select public.admin_set_coach_verification_status((select id from ids), 'verified') $$,
  '42501', null, 'nor call the admin decision');
select throws_ok($$ select public.admin_set_certification_status(
  (select id from public.coach_certifications limit 1), 'verified') $$, '42501', null, 'nor the admin credential decision');
reset role;
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.coach_profiles where id = (select id from ids)), 0,
  'another user cannot read the request');
select throws_ok($$ select public.request_coach_verification() $$, 'P0002', 'NO_COACH_PROFILE',
  'asking only ever acts on the caller''s own profile');
select throws_ok($$ select public.admin_set_coach_verification_status((select id from ids), 'verified') $$,
  '42501', null, 'another user cannot decide either');
reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('vera-verif') ->> 'verified', 'false', 'pending is not verified');
select ok(position('pending' in public.coach_public_profile('vera-verif')::text) = 0
          and position('ID and NASM' in public.coach_public_profile('vera-verif')::text) = 0,
  'the public sees neither the pending state nor the coach''s message');
reset role;

-- ============================================================================
-- 3. the admin rejects with a reason; the coach fixes and asks again
-- ============================================================================
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000003');
select is((public.admin_coach_profile_counts() ->> 'verification_pending')::int >= 1, true, 'the queue counts the request');
select is((select count(*)::int from public.admin_coach_profiles(null, 'pending') where id = (select id from ids)), 1,
  'and lists it');
select is(public.admin_coach_review((select id from ids)) ->> 'verification_message', 'ID and NASM card ready on request',
  'the admin reads the coach''s message');
select is(public.admin_coach_review((select id from ids)) #>> '{credentials,0,credential_number}', 'CPT-123456',
  'and the credential number');
select throws_ok($$ select public.admin_set_coach_verification_status((select id from ids), 'rejected') $$,
  '22023', 'REASON_REQUIRED', 'a rejection needs a reason');
select lives_ok($$ select public.admin_set_coach_verification_status((select id from ids), 'rejected', 'The NASM number does not match their registry.') $$,
  'the admin rejects');
select throws_ok($$ select public.admin_set_coach_verification_status((select id from ids), 'verified') $$,
  '22023', 'BAD_TRANSITION', 'a rejected coach is not verified directly');
reset role;
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000001');
select is((select verification_note from public.coach_profiles where user_id = auth.uid()),
  'The NASM number does not match their registry.', 'the coach sees why');
reset role;
select pg_temp.anonymous();
select ok(position('registry' in public.coach_public_profile('vera-verif')::text) = 0, 'the public never sees the reason');
reset role;
-- the coach fixes the credential: editing resets it to self-reported
update public.coach_profiles set status = 'draft' where id = (select id from ids);
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.coach_certifications set credential_number = 'CPT-654321' where name = 'NASM CPT' $$,
  'the coach corrects the credential number');
select is((select verification_status from public.coach_certifications where name = 'NASM CPT'), 'unverified',
  'an edited credential is self-reported again');
select is(public.request_coach_verification('Fixed the number'), '{}'::text[], 'rejected → pending: the coach asks again');
reset role;
update public.coach_profiles set status = 'published' where id = (select id from ids);

-- ============================================================================
-- 4. the admin verifies: Voinic Verified everywhere; credentials stay their own
-- ============================================================================
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.admin_set_coach_verification_status((select id from ids), 'verified') $$, 'the admin verifies');
select lives_ok($$ select public.admin_set_certification_status(
  (select id from public.coach_certifications where name = 'NASM CPT'), 'verified') $$, 'and verifies one credential');
reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('vera-verif') ->> 'verified', 'true', 'the public page says Voinic Verified');
select is(pg_temp.card_verified('vera'), 'true', 'so does the search card');
select is((public.search_coaches(p_query => 'vera', p_verified => true, p_accepting => false) ->> 'total')::int, 1,
  'and the verified filter finds them');
select is((select string_agg((c ->> 'name') || '=' || (c ->> 'verified'), ',' order by c ->> 'name')
           from jsonb_array_elements(public.coach_public_profile('vera-verif') -> 'certifications') c),
  'First aid=false,NASM CPT=true', 'a verified coach''s other credential is still only self-reported');
reset role;

-- ============================================================================
-- 5. revocation
-- ============================================================================
select pg_temp.authenticate_as('c6000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.admin_set_coach_verification_status((select id from ids), 'rejected', 'Certificate expired.') $$,
  'an admin can revoke, with a reason');
reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('vera-verif') ->> 'verified', 'false', 'and the badge is gone at once');
select is(public.coach_public_profile('vera-verif') -> 'badges', '[]'::jsonb, 'with the detail badges');
reset role;

select * from finish();
rollback;
