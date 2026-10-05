-- pgTAP · Coach onboarding end to end: become a coach → publish (via review)
-- → discoverable → hide → gone → show → back (20261029100000)
--
-- The lifecycle is pre-moderated (20261020100000, kept on 2026-10-05): the
-- coach submits, an admin approves. A published coach hides and shows their
-- own profile without a new review. Nobody but the owner moves their
-- profile, and nobody but an admin publishes.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_hide_and_review

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
create or replace function pg_temp.found(p_query text default null, p_city text default null)
returns int language sql as $fn$
  select (public.search_coaches(p_query => p_query, p_city => p_city, p_accepting => false) ->> 'total')::int;
$fn$;

-- 01 the user who becomes a coach · 02 another user (attacker) · 03 an admin · 04 a reader
insert into auth.users (id, email, raw_user_meta_data) values
  ('c4000000-0000-0000-0000-000000000001'::uuid, 'ioana@hide.local', '{"full_name":"Ioana","username":"ioana_hide"}'),
  ('c4000000-0000-0000-0000-000000000002'::uuid, 'mal@hide.local',   '{"full_name":"Mal","username":"mal_hide"}'),
  ('c4000000-0000-0000-0000-000000000003'::uuid, 'adm@hide.local',   '{"full_name":"Adm","username":"adm_hide"}'),
  ('c4000000-0000-0000-0000-000000000004'::uuid, 'rea@hide.local',   '{"full_name":"Rea","username":"rea_hide"}');
update public.users set role = 'admin' where id = 'c4000000-0000-0000-0000-000000000003';

-- ============================================================================
-- 1. a normal user becomes a coach: a private draft, nothing public
-- ============================================================================
select is((select count(*)::int from public.coach_profiles where user_id = 'c4000000-0000-0000-0000-000000000001'), 0,
  'a normal user has no coach profile');
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.become_coach() $$, 'the user starts onboarding');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'draft', 'and gets a draft');
reset role;
select is((select role from public.users where id = 'c4000000-0000-0000-0000-000000000001'), 'both',
  'a client who becomes a coach keeps client features (role both)');
select is(pg_temp.found('ioana'), 0, 'a draft is not in discovery');
select pg_temp.anonymous();
select is(public.coach_public_profile('ioana-hide'), null, 'nor is its page public');
reset role;

-- fill in the draft (the wizard's writes), then submit
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select ok(public.submit_coach_for_review() @> array['HEADLINE', 'ABOUT', 'SPECIALIZATION', 'SERVICE'],
  'an incomplete profile cannot be submitted, and says what is missing');
update public.coach_profiles set headline = 'Mobility coach', about = 'Pain-free strength.', online = true, in_person = true
 where user_id = auth.uid();
select public.coach_set_specializations(array['mobility'], 'mobility');
select public.coach_set_locations('[{"city":"cluj-napoca"}]');
insert into public.coach_services (coach_profile_id, name, kind, price_cents, price_unit)
select id, 'Online coaching', 'online_coaching', 30000, 'month' from public.coach_profiles where user_id = auth.uid();
reset role;
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/ioana.jpg'
 where id = 'c4000000-0000-0000-0000-000000000001';
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select is(public.coach_profile_missing(), '{}'::text[], 'the optional fields (certifications, cover, languages) are not required');
select is(public.submit_coach_for_review(), '{}'::text[], 'a complete draft is submitted');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'pending_review', 'and waits for review');
select is(pg_temp.found('ioana'), 0, 'pending review is not discoverable');

-- ============================================================================
-- 2. nobody else moves it, and the owner cannot publish themselves
-- ============================================================================
select throws_ok($$ update public.coach_profiles set status = 'published' where user_id = auth.uid() $$,
  '42501', null, 'the owner cannot write status');
select throws_ok($$ select public.admin_set_coach_profile_status(
  (select id from public.coach_profiles where user_id = auth.uid()), 'published') $$,
  '42501', null, 'nor call the admin approval');
select throws_ok($$ select public.admin_coach_review((select id from public.coach_profiles where user_id = auth.uid())) $$,
  '42501', null, 'nor read the admin review');
reset role;
create temp table ids as select id from public.coach_profiles where user_id = 'c4000000-0000-0000-0000-000000000001';
grant select on ids to authenticated, anon;
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.coach_profiles where id = (select id from ids)), 0,
  'another user cannot even see the profile');
update public.coach_profiles set headline = 'hacked' where id = (select id from ids);
select throws_ok($$ select public.hide_coach_profile() $$, 'P0002', 'NO_COACH_PROFILE',
  'hide only ever acts on the caller''s own profile');
select throws_ok($$ insert into public.coach_verifications (coach_profile_id, kind, status)
  values ((select id from ids), 'identity', 'verified') $$, '42501', null, 'nobody self-verifies');
reset role;
select is((select headline from public.coach_profiles where id = (select id from ids)), 'Mobility coach',
  'another user''s update changed nothing');

-- ============================================================================
-- 3. an admin reviews and approves; the coach is discoverable everywhere
-- ============================================================================
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000003');
select is((public.admin_coach_profile_counts() ->> 'pending_review')::int >= 1, true, 'the queue counts it');
select is(public.admin_coach_review((select id from ids)) ->> 'status', 'pending_review', 'the review page reads any status');
select is(public.admin_coach_review((select id from ids)) -> 'missing', '[]'::jsonb, 'with its open checklist');
select is(public.admin_coach_review((select id from ids)) ->> 'headline', 'Mobility coach',
  'in the public page''s own shape (the preview)');
select lives_ok($$ select public.admin_set_coach_profile_status((select id from ids), 'published') $$, 'the admin approves');
reset role;
select is(public.coach_public_profile('ioana-hide') -> 'badges', '[]'::jsonb, 'publishing never verifies anyone');

select pg_temp.anonymous();
select is(pg_temp.found('ioana'), 1, 'published: found by name');
select is(pg_temp.found('mobility'), 1, 'found by specialization');
select is((public.search_coaches(p_specializations => array['mobility'], p_city => 'cluj-napoca', p_accepting => false) ->> 'total')::int, 1,
  'found by the filters');
select ok(exists (select 1 from jsonb_array_elements(public.coach_discovery_facets() -> 'cities') c where c ->> 'slug' = 'cluj-napoca'),
  'their city is offered as a filter');
select is(public.coach_public_profile('ioana-hide') ->> 'headline', 'Mobility coach', 'and the page is public');
reset role;

-- ============================================================================
-- 4. hide: gone from discovery, the account keeps working
-- ============================================================================
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.show_coach_profile() $$, '55000', 'BAD_TRANSITION', 'a published profile cannot be "shown"');
select lives_ok($$ select public.hide_coach_profile() $$, 'the coach hides their profile');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'hidden', 'published → hidden');
select throws_ok($$ update public.coach_profiles set headline = 'Edited while hidden' where user_id = auth.uid() $$,
  '55000', 'PROFILE_LOCKED', 'content stays as approved while hidden');
select lives_ok($$ insert into public.social_posts (user_id, type, text, visibility) values (auth.uid(), 'text', 'Still here', 'public') $$,
  'the rest of the account works as before');
reset role;
select pg_temp.anonymous();
select is(pg_temp.found('ioana'), 0, 'hidden: not in search');
select is(public.coach_public_profile('ioana-hide'), null, 'hidden: no public page');
select ok(not exists (select 1 from jsonb_array_elements(public.coach_discovery_facets() -> 'cities') c where c ->> 'slug' = 'cluj-napoca'),
  'hidden: their city is no longer a filter option');
reset role;
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000004');
select throws_ok($$ select public.request_coaching((select id from ids)) $$, 'P0002', 'COACH_NOT_FOUND',
  'hidden: nobody can send a coaching request');
reset role;

-- ============================================================================
-- 5. show: back without a review; refused when the checklist no longer passes
-- ============================================================================
update public.users set avatar_url = null where id = 'c4000000-0000-0000-0000-000000000001';
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select is(public.show_coach_profile(), array['AVATAR'], 'show re-checks the profile (the photo was removed)');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'hidden', 'and it stays hidden');
reset role;
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/ioana2.jpg'
 where id = 'c4000000-0000-0000-0000-000000000001';
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select is(public.show_coach_profile(), '{}'::text[], 'with a photo again, show works');
select is((select status from public.coach_profiles where user_id = auth.uid()), 'published', 'hidden → published, no review');
reset role;
select pg_temp.anonymous();
select is(pg_temp.found('ioana'), 1, 'discoverable again');
reset role;

-- ============================================================================
-- 6. editing after onboarding: withdraw from hidden, admin moves on hidden
-- ============================================================================
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000001');
select public.hide_coach_profile();
select lives_ok($$ select public.withdraw_coach_profile() $$, 'a hidden profile can be withdrawn to edit');
select lives_ok($$ update public.coach_profiles set headline = 'Mobility & strength coach' where user_id = auth.uid() $$,
  'and edited as a draft');
reset role;
update public.coach_profiles set status = 'hidden' where id = (select id from ids);
select pg_temp.authenticate_as('c4000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.admin_set_coach_profile_status((select id from ids), 'draft') $$,
  '22023', 'REASON_REQUIRED', 'an admin sending a hidden profile back to draft must say why');
select throws_ok($$ select public.admin_set_coach_profile_status((select id from ids), 'hidden') $$,
  '22023', 'BAD_TRANSITION', 'hiding is the coach''s switch, not an admin''s');
reset role;

select * from finish();
rollback;
