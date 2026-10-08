-- pgTAP · Coach Discovery 2.0 and profile content (20261111100000, 20261111110000)
--
-- Profile content: the four new fields, their validation (closed goal codes,
-- handles not URLs), the edit lock, staged revisions, the public payload and
-- its availability summary. Search: where a word matched decides its weight
-- (name > headline / specialization / city > services > bio), an exact name
-- is found first, the new filters (service kind, language, minimum rating,
-- available) and sorts (rating, availability, relevance), facets, and the
-- public output still carrying no score, part, signal or timestamp.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_discovery_v2

begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

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
create or replace function pg_temp.pos(r jsonb, p_slug text) returns int language sql as $fn$
  select o::int from jsonb_array_elements(r -> 'items') with ordinality as t(i, o) where i ->> 'slug' = p_slug;
$fn$;
create or replace function pg_temp.slugs(r jsonb) returns text[] language sql as $fn$
  select coalesce(array_agg(i ->> 'slug' order by o), '{}') from jsonb_array_elements(r -> 'items') with ordinality as t(i, o);
$fn$;

-- 01 andrei_pop · 02 mihai_bio (mentions Andrei, verified, 150 reviews) · 03 kb_head · 04 kb_svc · 05 kb_about
-- 06 av_coach (bookable, Romanian, 5.0 from one review) · 07 rate_low · 08 draft_dv (stays a draft)
-- c1 a client · ad an admin
insert into auth.users (id, email, raw_user_meta_data)
select ('dd000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, u || '@dv.local',
       json_build_object('full_name', initcap(u), 'username', u)::jsonb
from (values (1, 'andrei_pop'), (2, 'mihai_bio'), (3, 'kb_head'), (4, 'kb_svc'), (5, 'kb_about'), (6, 'av_coach'),
             (7, 'rate_low'), (8, 'draft_dv')) v(n, u);
insert into auth.users (id, email, raw_user_meta_data) values
  ('dd000000-0000-0000-0000-0000000000c1', 'client@dv.local', '{"full_name":"Client","username":"dv_client"}'),
  ('dd000000-0000-0000-0000-0000000000ad', 'admin@dv.local', '{"full_name":"Admin","username":"dv_admin"}');
update public.users set role = 'admin' where id = 'dd000000-0000-0000-0000-0000000000ad';
update public.users set timezone = 'Europe/Bucharest' where id::text like 'dd000000-%';

do $$
declare r record;
begin
  for r in select id from auth.users where email like '%@dv.local' and email not in ('client@dv.local', 'admin@dv.local') loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id::text, 'role', 'authenticated')::text, true);
    perform public.become_coach();
  end loop;
end;
$$;

update public.coach_profiles set headline = 'Coach', online = true, in_person = false, accepting_clients = true
 where user_id in (select id from auth.users where email like '%@dv.local');
update public.coach_profiles set headline = 'Kettlebell specialist' where slug = 'kb-head';
update public.coach_profiles set about = 'I trained alongside Andrei for years.' where slug = 'mihai-bio';
update public.coach_profiles set about = 'Some kettlebell work too.' where slug = 'kb-about';
insert into public.coach_services (coach_profile_id, name, price_cents, price_unit, delivery, kind)
select cp.id, x.name, x.price, 'session', 'online', x.kind
from (values ('kb-svc', 'Kettlebell class', 9000, 'group_coaching'), ('av-coach', 'Video call PT', 15000, 'personal_training'),
             ('andrei-pop', 'Online plan', 20000, 'online_coaching')) x(slug, name, price, kind)
join public.coach_profiles cp on cp.slug = x.slug;
insert into public.coach_languages (coach_profile_id, language_code)
select id, 'ro' from public.coach_profiles where slug = 'av-coach';
insert into public.coach_languages (coach_profile_id, language_code)
select id, 'en' from public.coach_profiles where slug in ('andrei-pop', 'mihai-bio');
update public.coach_profiles set verification_status = 'verified', review_count = 150, review_avg = 4.90 where slug = 'mihai-bio';
update public.coach_profiles set review_count = 1, review_avg = 5.00 where slug = 'av-coach';
update public.coach_profiles set review_count = 20, review_avg = 2.00 where slug = 'rate-low';
-- Andrei is complete (a revision can only be submitted for a complete profile)
update public.users set avatar_url = 'https://res.cloudinary.com/demo/image/upload/a.jpg' where username = 'andrei_pop';
update public.coach_profiles set about = 'Strength coach.' where slug = 'andrei-pop';
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, true from public.coach_profiles cp, public.specializations s where cp.slug = 'andrei-pop' and s.slug = 'strength';

-- ============================================================================
-- 1. profile content: written in draft, validated, locked once live
-- ============================================================================
select pg_temp.authenticate_as('dd000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.coach_profiles set approach = 'Small steps, weekly check-ins.',
                     experience_summary = 'Eight years in a gym in Cluj.', client_goals = array['strength', 'beginners'],
                     social_links = '{"instagram":"andrei.pop","website":"https://andrei.example.ro/about"}'
                   where user_id = auth.uid() $$,
  'a draft takes approach, experience, goals and links');
select throws_ok($$ update public.coach_profiles set social_links = '{"website":"javascript:alert(1)"}' where user_id = auth.uid() $$,
  '23514', null, 'a website must be https');
select throws_ok($$ update public.coach_profiles set social_links = '{"instagram":"https://instagram.com/x"}' where user_id = auth.uid() $$,
  '23514', null, 'a handle, never a URL');
select throws_ok($$ update public.coach_profiles set social_links = '{"myspace":"x"}' where user_id = auth.uid() $$,
  '23514', null, 'only the known networks');
select throws_ok($$ update public.coach_profiles set client_goals = array['guaranteed_results'] where user_id = auth.uid() $$,
  '23514', null, 'client goals are closed codes');
select throws_ok($$ update public.coach_profiles set client_goals = array['strength','fat_loss','mobility','endurance','beginners','muscle_gain','healthy_habits'] where user_id = auth.uid() $$,
  '23514', null, 'six goals at most');
select throws_ok($$ update public.coach_profiles set approach = repeat('x', 1501) where user_id = auth.uid() $$,
  '23514', null, 'the approach is capped');
reset role;

-- everyone but the draft goes live (by the owner of the tables, as an admin approval would)
update public.coach_profiles set status = 'published', published_at = now() - interval '100 days'
 where user_id in (select id from auth.users where email like '%@dv.local') and slug <> 'draft-dv';

select pg_temp.authenticate_as('dd000000-0000-0000-0000-000000000001');
select throws_ok($$ update public.coach_profiles set approach = 'changed' where user_id = auth.uid() $$,
  '55000', 'PROFILE_LOCKED', 'live content is locked (it goes through a revision)');
select throws_ok($$ update public.coach_profiles set social_links = '{}' where user_id = auth.uid() $$,
  '55000', 'PROFILE_LOCKED', 'links are content too');
reset role;

select pg_temp.anonymous();
select is(public.coach_public_profile('andrei-pop') ->> 'approach', 'Small steps, weekly check-ins.', 'the public page carries the approach');
select is(public.coach_public_profile('andrei-pop') ->> 'experience_summary', 'Eight years in a gym in Cluj.', '… the experience');
select is(public.coach_public_profile('andrei-pop') -> 'client_goals', '["strength", "beginners"]'::jsonb, '… the goals as codes');
select is(public.coach_public_profile('andrei-pop') -> 'social_links' ->> 'instagram', 'andrei.pop', '… the handles');
select is((public.coach_public_profile('andrei-pop') -> 'availability' ->> 'bookable')::boolean, false,
  'availability: not bookable without a bookable service');
select is(public.coach_public_profile('draft-dv'), null, 'a draft is still not a public page');
select ok(not has_function_privilege('anon', 'public.coach_public_profile_base(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.coach_public_profile_base(text)', 'execute'),
  'the layered base is internal');
select ok(not has_function_privilege('authenticated', 'public.coach_profile_content(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.coach_public_availability(uuid)', 'execute'),
  'the content and availability builders are internal');
reset role;

-- ---------- a staged revision carries the new fields ----------
select pg_temp.authenticate_as('dd000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.coach_revision_start() $$, 'the live coach opens a revision');
select is(public.coach_my_revision_payload() ->> 'approach', 'Small steps, weekly check-ins.', 'the copy starts from the live approach');
select lives_ok($$ select public.coach_revision_save(public.coach_my_revision_payload()
                     || '{"approach":"Strength first, then everything else.","client_goals":["strength"]}'::jsonb) $$,
  'the coach edits the copy');
select throws_ok($$ select public.coach_revision_save(public.coach_my_revision_payload() || '{"social_links":{"website":"http://x.ro"}}'::jsonb) $$,
  '22023', null, 'the copy is judged by the real constraints');
select lives_ok($$ select public.coach_revision_submit() $$, 'and submits it');
reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('andrei-pop') ->> 'approach', 'Small steps, weekly check-ins.', 'the public page waits for the admin');
reset role;
select pg_temp.authenticate_as('dd000000-0000-0000-0000-0000000000ad');
select is(public.admin_coach_review((select id from public.coach_profiles where slug = 'andrei-pop')) ->> 'approach',
  'Small steps, weekly check-ins.', 'the admin review shows the content fields');
select lives_ok($$ select public.admin_decide_coach_revision((select id from public.coach_profiles where slug = 'andrei-pop'), true, null) $$,
  'the admin approves');
reset role;
select pg_temp.anonymous();
select is(public.coach_public_profile('andrei-pop') ->> 'approach', 'Strength first, then everything else.', 'approved: the new approach is live');
select is(public.coach_public_profile('andrei-pop') -> 'client_goals', '["strength"]'::jsonb, '… and the goals');
select is(public.coach_public_profile('andrei-pop') -> 'social_links' ->> 'website', 'https://andrei.example.ro/about',
  'a field the copy did not change keeps its value');
reset role;
select pg_temp.authenticate_as('dd000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.admin_coach_review((select id from public.coach_profiles where slug = 'andrei-pop')) $$,
  '42501', null, 'the admin review is still admin-only');
reset role;

-- ============================================================================
-- 2. availability: bookable, with weekly hours → a next slot, a filter, a sort
-- ============================================================================
select pg_temp.authenticate_as('dd000000-0000-0000-0000-000000000006');
select public.coach_set_service_booking((select id from public.coach_services where name = 'Video call PT'),
                                        true, 60, 0, 0, 60, 30, 'public', 'instant');
insert into public.coach_availability (coach_id, weekday, start_time, end_time)
select auth.uid(), wd, '06:00', '22:00' from generate_series(1, 7) wd;
reset role;
select public.coach_rank_signals_refresh();

select pg_temp.anonymous();
select is((public.coach_public_profile('av-coach') -> 'availability' ->> 'bookable')::boolean, true, 'availability: bookable');
select ok((public.coach_public_profile('av-coach') -> 'availability' ->> 'next_slot_at')::timestamptz > now(),
  'availability: the next free slot, in the future');
select is(public.coach_public_profile('av-coach') -> 'availability' ->> 'timezone', 'Europe/Bucharest', 'availability: in the coach''s zone');

-- ============================================================================
-- 3. where a word matched decides its weight
-- ============================================================================
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'andrei'), 'andrei-pop'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'andrei'), 'mihai-bio'),
  'a name match ranks above a bio mention — even of a verified, much-reviewed coach');
select is(pg_temp.pos(public.search_coaches(p_query => 'andrei_pop'), 'andrei-pop'), 1, 'the exact public name is first');
select is(pg_temp.pos(public.search_coaches(p_query => '@Andrei_Pop'), 'andrei-pop'), 1, '… with an @ and any case');
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'kettlebell'), 'kb-head'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'kettlebell'), 'kb-svc'),
  'a headline match above a service match');
select cmp_ok(pg_temp.pos(public.search_coaches(p_query => 'kettlebell'), 'kb-svc'), '<',
              pg_temp.pos(public.search_coaches(p_query => 'kettlebell'), 'kb-about'),
  'a service match above a bio mention');
select ok(pg_temp.pos(public.search_coaches(p_query => 'alongside'), 'mihai-bio') is not null, 'a bio word still finds the coach');
select ok(pg_temp.pos(public.search_coaches(p_query => 'weekly'), 'andrei-pop') is null
          and pg_temp.pos(public.search_coaches(p_query => 'everything'), 'andrei-pop') is not null,
  'the approach is searchable, and only the live one');
select is(pg_temp.pos(public.search_coaches(p_query => 'kettlebel'), 'kb-head'), 1, 'a near miss still finds the headline first');

-- ============================================================================
-- 4. filters
-- ============================================================================
select is(pg_temp.slugs(public.search_coaches(p_service_kinds => array['group_coaching'])), array['kb-svc'],
  'service kind: only coaches offering that kind');
select is(pg_temp.slugs(public.search_coaches(p_languages => array['ro'])), array['av-coach'], 'language: any of the chosen');
select is(pg_temp.slugs(public.search_coaches(p_languages => array['ro', 'en'], p_sort => 'newest'))::text[] @> array['av-coach', 'andrei-pop', 'mihai-bio'],
  true, 'languages combine as any-of');
select is(pg_temp.slugs(public.search_coaches(p_min_rating => 4.5, p_sort => 'rating')), array['mihai-bio', 'av-coach'],
  'minimum rating: only rated coaches at or above it');
select is((public.search_coaches(p_min_rating => 9) ->> 'total')::int, (public.search_coaches() ->> 'total')::int,
  'an impossible minimum rating is ignored, not an error');
select is(pg_temp.slugs(public.search_coaches(p_available => true)), array['av-coach'], 'available: a free public slot within 14 days');

-- ============================================================================
-- 5. sorts
-- ============================================================================
select cmp_ok(pg_temp.pos(public.search_coaches(p_sort => 'rating'), 'mihai-bio'), '<',
              pg_temp.pos(public.search_coaches(p_sort => 'rating'), 'av-coach'),
  'rating: 4.9 from 150 reviews above 5.0 from one (Bayesian)');
select cmp_ok(pg_temp.pos(public.search_coaches(p_sort => 'rating'), 'kb-head'), '<',
              pg_temp.pos(public.search_coaches(p_sort => 'rating'), 'rate-low'),
  'rating: no reviews is neutral, above a poor rating');
select is(pg_temp.pos(public.search_coaches(p_sort => 'availability'), 'av-coach'), 1, 'availability: the coach with the soonest slot first');
select ok(pg_temp.pos(public.search_coaches(p_query => 'andrei', p_sort => 'relevance'), 'andrei-pop')
          < pg_temp.pos(public.search_coaches(p_query => 'andrei', p_sort => 'relevance'), 'mihai-bio'),
  'most relevant: the match alone decides');
select ok(pg_temp.pos(public.search_coaches(p_query => 'andrei_pop', p_sort => 'newest'), 'andrei-pop') is not null,
  'the exact name is never forced first in a pure sort (it is still listed)');
select is(pg_temp.slugs(public.search_coaches(p_sort => 'bogus')), pg_temp.slugs(public.search_coaches()),
  'an unknown sort is recommended');

-- ============================================================================
-- 6. what the public sees
-- ============================================================================
select is(((public.search_coaches(p_sort => 'availability') -> 'items' -> 0) ->> 'available_soon')::boolean, true,
  'a card says available soon');
select is((select count(*)::int from jsonb_array_elements(public.search_coaches() -> 'items') i
            where i ?| array['score', 'relevance', 'trust', 'quality', 'signals', 'next_available_at', 'exact_name', 'rating_bayes']),
  0, 'no score, part, signal or timestamp on any card');
select ok((select bool_and(s ? 'coaches') from jsonb_array_elements(public.coach_discovery_facets() -> 'specializations') s),
  'facets: specializations carry a coach count');
select is((select (l ->> 'coaches')::int from jsonb_array_elements(public.coach_discovery_facets() -> 'languages') l where l ->> 'code' = 'ro'),
  1, 'facets: languages spoken by published coaches, counted');
select ok(not exists (select 1 from jsonb_array_elements(public.coach_discovery_facets() -> 'languages') l where l ->> 'code' = 'fr'),
  'facets: a language nobody speaks is not offered');
select is((select (k ->> 'coaches')::int from jsonb_array_elements(public.coach_discovery_facets() -> 'service_kinds') k
            where k ->> 'kind' = 'group_coaching'), 1, 'facets: service kinds, counted');
select ok(not has_function_privilege('anon', 'public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, boolean, boolean, uuid, boolean, text[], text[], numeric, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.coach_ranked(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, boolean, boolean, uuid, boolean, text[], text[], numeric, boolean)', 'execute'),
  'the ranking layer stays internal');
reset role;

select pg_temp.authenticate_as('dd000000-0000-0000-0000-0000000000ad');
select ok((select count(*) from public.admin_coach_ranking(p_query => 'andrei')) >= 2, 'the admin inspector reads the same layer');
reset role;

select * from finish();
rollback;
