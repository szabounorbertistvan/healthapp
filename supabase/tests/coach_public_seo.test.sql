-- pgTAP · The public coach directory's SEO foundation (20261107100000)
--
-- What an anonymous request — a visitor from Instagram, a crawler — can and
-- cannot get: a published coach's page, never a draft, hidden, suspended or
-- deleting one; no private field in what is returned; a sitemap of indexable
-- coaches only; old slugs that keep working for the same coach and are never
-- handed to another.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_public_seo

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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

-- coaches: P public · D draft · S suspended · H hidden · T thin (avatar removed after approval) · X deleting · C a client
insert into auth.users (id, email, raw_user_meta_data) values
  ('cd000000-0000-0000-0000-000000000001'::uuid, 'pat@seo.local', '{"full_name":"Pat","username":"pat_seo"}'),
  ('cd000000-0000-0000-0000-000000000002'::uuid, 'dan@seo.local', '{"full_name":"Dan","username":"dan_seo"}'),
  ('cd000000-0000-0000-0000-000000000003'::uuid, 'sue@seo.local', '{"full_name":"Sue","username":"sue_seo"}'),
  ('cd000000-0000-0000-0000-000000000004'::uuid, 'hal@seo.local', '{"full_name":"Hal","username":"hal_seo"}'),
  ('cd000000-0000-0000-0000-000000000005'::uuid, 'tom@seo.local', '{"full_name":"Tom","username":"tom_seo"}'),
  ('cd000000-0000-0000-0000-000000000006'::uuid, 'xia@seo.local', '{"full_name":"Xia","username":"xia_seo"}'),
  ('cd000000-0000-0000-0000-000000000007'::uuid, 'cli@seo.local', '{"full_name":"Cli","username":"cli_seo"}');
update public.users set avatar_url = 'https://res.cloudinary.com/x/' || username || '.jpg', city = 'Private Town'
 where id::text like 'cd000000%';
do $$
declare u uuid;
begin
  foreach u in array array['cd000000-0000-0000-0000-000000000001', 'cd000000-0000-0000-0000-000000000002',
                           'cd000000-0000-0000-0000-000000000003', 'cd000000-0000-0000-0000-000000000004',
                           'cd000000-0000-0000-0000-000000000005', 'cd000000-0000-0000-0000-000000000006']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
    perform public.become_coach();
  end loop;
end $$;
update public.coach_profiles set headline = 'Strength coach', about = 'Ten years of strength coaching.', online = true,
       status = 'published', published_at = now() - interval '1 day', review_note = 'internal note', verification_message = 'internal'
 where slug in ('pat-seo', 'sue-seo', 'hal-seo', 'tom-seo', 'xia-seo');
update public.coach_profiles set status = 'hidden' where slug = 'hal-seo';
update public.coach_profiles set headline = 'Draft', about = 'Draft' where slug = 'dan-seo';
update public.users set suspended_at = now() where id = 'cd000000-0000-0000-0000-000000000003';
update public.users set avatar_url = null where id = 'cd000000-0000-0000-0000-000000000005';
insert into public.account_deletion_requests (user_id) values ('cd000000-0000-0000-0000-000000000006');
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, (select s.id from public.specializations s where s.active order by s.sort_order limit 1), true
from public.coach_profiles cp where cp.slug like '%-seo';
insert into public.coach_services (coach_profile_id, name, price_cents, price_unit)
select cp.id, 'Coaching', 20000, 'month' from public.coach_profiles cp where cp.slug like '%-seo';

-- ============================================================================
-- 1. who is public
-- ============================================================================
select pg_temp.anonymous();
select isnt(public.coach_public_profile('pat-seo'), null, 'a published coach is public without an account');
select is(public.coach_public_profile('dan-seo'), null, 'a draft is not');
select is(public.coach_public_profile('sue-seo'), null, 'a suspended coach is not');
select is(public.coach_public_profile('hal-seo'), null, 'a hidden profile is not');
select is(public.coach_public_profile('xia-seo'), null, 'an account being deleted is not');
select is(public.coach_public_profile('nobody-here'), null, 'an unknown slug is nothing, not an error');
select is(public.coach_public_profile('../../etc'), null, 'nor is a malformed one');
select is((select count(*)::int from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i
           where i ->> 'slug' like '%-seo'), 2, 'the anonymous directory lists only the public ones (pat, tom)');

-- ============================================================================
-- 2. nothing private in what an anonymous request gets
-- ============================================================================
create temp table pub as select public.coach_public_profile('pat-seo') as j;
grant select on pub to anon;
select ok(not ((select j from pub) ? 'email'), 'no e-mail');
select is((select j ->> 'user_id' from pub), null, 'no account id for an anonymous reader');
select ok(not ((select j from pub) ? 'review_note'), 'no admin review note');
select ok(not ((select j from pub) ? 'verification_message'), 'no verification correspondence');
select ok(not ((select j from pub) ? 'suspension_reason'), 'no suspension reason');
select ok(position('Private Town' in (select j::text from pub)) = 0, 'not the account''s own city field');
select ok(position('cli_seo' in (select j::text from pub)) = 0, 'nothing about anyone else');
select throws_ok($$ select * from public.coach_profiles $$, '42501', null, 'the profiles table is not readable anonymously');
select throws_ok($$ select full_name, city from public.users $$, '42501', null, 'nor the users table');
select throws_ok($$ select * from public.coach_slug_redirects $$, '42501', null, 'nor the slug history');
reset role;

-- ============================================================================
-- 3. the sitemap
-- ============================================================================
select pg_temp.anonymous();
select is((select array_agg(slug order by slug) from public.coach_sitemap() where slug like '%-seo'), array['pat-seo'],
  'the sitemap lists the public, complete coach only — not the thin one, the draft, the hidden, the suspended or the deleting');
select is((select count(*)::int from information_schema.routines r
           join information_schema.parameters p on p.specific_name = r.specific_name
           where r.routine_name = 'coach_sitemap' and p.parameter_mode = 'OUT'), 2, 'and returns slug and date only');
reset role;

-- ============================================================================
-- 4. permanent links
-- ============================================================================
update public.coach_profiles set slug = 'pat-strength' where slug = 'pat-seo';
select pg_temp.anonymous();
select is(public.coach_slug_redirect('pat-seo'), 'pat-strength', 'an old slug points at the current one');
select is(public.coach_slug_redirect('PAT-SEO '), 'pat-strength', 'whatever its case and spacing');
select is(public.coach_slug_redirect('nobody-here'), null, 'an unknown slug points nowhere');
reset role;
select throws_ok($$ update public.coach_profiles set slug = 'pat-seo' where slug = 'tom-seo' $$,
  '23505', 'SLUG_TAKEN', 'another coach cannot take an old slug: its links stay with its coach');
select throws_ok($$ update public.coach_profiles set slug = 'pat-strength' where slug = 'tom-seo' $$,
  '23505', null, 'nor a live one (the unique index)');
update public.coach_profiles set slug = 'pat-seo' where slug = 'pat-strength';
select is((select count(*)::int from public.coach_slug_redirects where old_slug = 'pat-seo'), 0,
  'the owner takes their old slug back: live again, not a redirect');
select is((select coach_profile_id from public.coach_slug_redirects where old_slug = 'pat-strength'),
  (select id from public.coach_profiles where slug = 'pat-seo'), 'and the slug they left now redirects');
update public.coach_profiles set slug = 'hal-new' where slug = 'hal-seo';
select pg_temp.anonymous();
select is(public.coach_slug_redirect('hal-seo'), null, 'an old slug never reveals a coach who is not public');
reset role;
update public.coach_profiles set slug = 'dan-new' where slug = 'dan-seo';
select is((select count(*)::int from public.coach_slug_redirects where old_slug = 'dan-seo'), 0,
  'a slug never published leaves no history');

-- ============================================================================
-- 5. signed in: the same page, the reader's own state on top
-- ============================================================================
select pg_temp.authenticate_as('cd000000-0000-0000-0000-000000000007');
select is((public.coach_public_profile('pat-seo') ->> 'user_id')::uuid, 'cd000000-0000-0000-0000-000000000001'::uuid,
  'a signed-in reader gets the id the follow and save buttons need');
select ok(not (public.coach_public_profile('pat-seo') ? 'email'), 'but still no e-mail');
select is(public.coach_public_profile('sue-seo'), null, 'and still nothing for a suspended coach');
reset role;

select * from finish();
rollback;
