-- pgTAP · Coach Discovery search (20261022100000, viewer keys 20261026100000,
-- verified / hybrid / gym filters 20261027100000)
--
-- search_coaches() and coach_discovery_facets() are open to anonymous callers.
-- Only published coaches of live accounts come out, only public fields, and a
-- private price never takes part in a price filter.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_search

begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

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
-- the slugs of a result, in order
create or replace function pg_temp.slugs(r jsonb) returns text language sql as $fn$
  select coalesce(string_agg(i ->> 'slug', ',' order by o), '') from jsonb_array_elements(r -> 'items') with ordinality as t(i, o);
$fn$;

-- a: Cluj, both formats, hypertrophy+strength, since 2010, accepting, a follower, a private price
-- b: online only, weight loss + nutrition, since 2022, NOT accepting
-- c: Bucharest, in person, powerlifting, since 2018, EUR price, verified
-- d draft · e pending · f suspended profile · g published but the account is suspended — all "hypertrophy"
-- v: a reader
insert into auth.users (id, email, raw_user_meta_data) values
  ('ce000000-0000-0000-0000-00000000000a', 'ana@search.local',  '{"full_name":"ana@search.local","username":"ana_search"}'),
  ('ce000000-0000-0000-0000-00000000000b', 'bob@search.local',  '{"full_name":"Bogdan","username":"bogdan_fit"}'),
  ('ce000000-0000-0000-0000-00000000000c', 'cri@search.local',  '{"full_name":"Cristi","username":"cristi_pl"}'),
  ('ce000000-0000-0000-0000-00000000000d', 'd@search.local',    '{"full_name":"Dan","username":"dan_draft_s"}'),
  ('ce000000-0000-0000-0000-00000000000e', 'e@search.local',    '{"full_name":"Eva","username":"eva_pending_s"}'),
  ('ce000000-0000-0000-0000-00000000000f', 'f@search.local',    '{"full_name":"Fane","username":"fane_susp_s"}'),
  ('ce000000-0000-0000-0000-000000000010', 'g@search.local',    '{"full_name":"Gelu","username":"gelu_banned_s"}'),
  ('ce000000-0000-0000-0000-000000000011', 'v@search.local',    '{"full_name":"Vio","username":"vio_reader"}');

select pg_temp.authenticate_as('ce000000-0000-0000-0000-00000000000a'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-00000000000b'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-00000000000c'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-00000000000d'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-00000000000e'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-00000000000f'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000010'); select public.become_coach(); reset role;

update public.coach_profiles set headline = 'Hypertrophy coach', online = true, in_person = true, coaching_since = 2010
 where slug = 'ana-search';
update public.coach_profiles set headline = 'Weight loss', online = true, in_person = false, coaching_since = 2022,
       accepting_clients = false where slug = 'bogdan-fit';
update public.coach_profiles set headline = 'Powerlifting', online = false, in_person = true, coaching_since = 2018
 where slug = 'cristi-pl';
update public.coach_profiles set headline = 'Hypertrophy coach', in_person = true
 where slug in ('dan-draft-s', 'eva-pending-s', 'fane-susp-s', 'gelu-banned-s');

insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, s.slug = 'hypertrophy' from public.coach_profiles cp, public.specializations s
 where cp.slug = 'ana-search' and s.slug in ('hypertrophy', 'strength');
insert into public.coach_specializations (coach_profile_id, specialization_id)
select cp.id, s.id from public.coach_profiles cp, public.specializations s
 where cp.slug = 'bogdan-fit' and s.slug in ('weight-loss', 'nutrition');
insert into public.coach_specializations (coach_profile_id, specialization_id)
select cp.id, s.id from public.coach_profiles cp, public.specializations s
 where cp.slug = 'cristi-pl' and s.slug = 'powerlifting';
insert into public.coach_specializations (coach_profile_id, specialization_id)
select cp.id, s.id from public.coach_profiles cp, public.specializations s
 where cp.slug in ('dan-draft-s', 'eva-pending-s', 'fane-susp-s', 'gelu-banned-s') and s.slug = 'hypertrophy';

insert into public.coach_locations (coach_profile_id, city_id)
select cp.id, c.id from public.coach_profiles cp, public.cities c
 where (cp.slug in ('ana-search', 'dan-draft-s', 'eva-pending-s', 'fane-susp-s', 'gelu-banned-s') and c.slug = 'cluj-napoca')
    or (cp.slug = 'cristi-pl' and c.slug = 'bucharest');

insert into public.coach_services (coach_profile_id, name, price_cents, currency, price_unit, price_public)
select id, 'Online plan', 20000, 'RON', 'month', true from public.coach_profiles where slug = 'ana-search';
insert into public.coach_services (coach_profile_id, name, price_cents, currency, price_unit, price_public)
select id, 'Secret VIP', 999999, 'RON', 'session', false from public.coach_profiles where slug = 'ana-search';
insert into public.coach_services (coach_profile_id, name, price_cents, currency, price_unit, price_public)
select id, 'Fat loss plan', 15000, 'RON', 'month', true from public.coach_profiles where slug = 'bogdan-fit';
insert into public.coach_services (coach_profile_id, name, price_cents, currency, price_unit, price_public)
select id, 'Meet prep', 5000, 'EUR', 'session', true from public.coach_profiles where slug = 'cristi-pl';
insert into public.coach_certifications (coach_profile_id, name, document_ref)
select id, 'ISSA', 'vault://secret-search-doc' from public.coach_profiles where slug = 'ana-search';
insert into public.coach_verifications (coach_profile_id, kind, status)
select id, 'identity', 'verified' from public.coach_profiles where slug = 'cristi-pl';
-- Voinic Verified is the coach-level decision (20261101100000), not the kind row alone
update public.coach_profiles set verification_status = 'verified' where slug = 'cristi-pl';

update public.coach_profiles set status = 'published', published_at = now() - interval '3 days' where slug = 'ana-search';
update public.coach_profiles set status = 'published', published_at = now() - interval '2 days' where slug = 'bogdan-fit';
update public.coach_profiles set status = 'published', published_at = now() - interval '1 day' where slug = 'cristi-pl';
update public.coach_profiles set status = 'published', published_at = now() where slug = 'gelu-banned-s';
update public.coach_profiles set status = 'pending_review' where slug = 'eva-pending-s';
update public.coach_profiles set status = 'suspended', suspended_at = now(), suspension_reason = 'x' where slug = 'fane-susp-s';
update public.users set suspended_at = now() where id = 'ce000000-0000-0000-0000-000000000010';
insert into public.gyms (id, name, city, status)
values ('ce000000-0000-0000-0000-0000000000f1', 'Iron Temple Gym', 'Cluj-Napoca', 'active'),
       ('ce000000-0000-0000-0000-0000000000f2', 'Pending Gym', 'Cluj-Napoca', 'pending');
update public.coach_locations set gym_id = 'ce000000-0000-0000-0000-0000000000f1', gym_name = 'Iron Temple Gym'
 where coach_profile_id in (select id from public.coach_profiles where slug in ('ana-search', 'dan-draft-s'));
insert into public.social_follows (follower_id, following_id)
values ('ce000000-0000-0000-0000-000000000011', 'ce000000-0000-0000-0000-00000000000a'),
       ('ce000000-0000-0000-0000-00000000000c', 'ce000000-0000-0000-0000-000000000011');

-- ============================================================================
-- 1. anonymous: who comes out
-- ============================================================================
select pg_temp.anonymous();
select ok(has_function_privilege('anon', 'public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid, boolean)', 'execute'),
  '15. anonymous callers may search');
select is((public.search_coaches() ->> 'total')::int, 2, '1. by default: the published coaches that accept clients');
select is((public.search_coaches(p_accepting => false) ->> 'total')::int, 3, 'accepting=false lists every published coach');
select ok(pg_temp.slugs(public.search_coaches(p_query => 'hypertrophy', p_accepting => false)) = 'ana-search',
  '2-4. draft, pending, suspended and suspended-account coaches never come out');
select is((public.search_coaches(p_query => 'dan_draft_s', p_accepting => false) ->> 'total')::int, 0, '2. a draft coach is not found by name');
select ok(position('@' in public.search_coaches(p_accepting => false)::text) = 0
          and position('secret-search-doc' in public.search_coaches(p_accepting => false)::text) = 0
          and position('999999' in public.search_coaches(p_accepting => false)::text) = 0,
  '5. no e-mail, no document, no private price in the result');
select ok(not exists (select 1 from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i
                      where i ?| array['status', 'email', 'full_name', 'user_id', 'about', 'search_text', 'rank_score',
                                      'is_self', 'is_following', 'follows_me']),
  '5. no private or internal key on a card');

-- ============================================================================
-- 2. text
-- ============================================================================
select is(pg_temp.slugs(public.search_coaches(p_query => 'ana_search')), 'ana-search', '6. by username');
select is(pg_temp.slugs(public.search_coaches(p_query => 'Bogdan', p_accepting => false)), 'bogdan-fit', '6. by public name');
select is(pg_temp.slugs(public.search_coaches(p_query => 'hipertrofie')), 'ana-search', '7. by specialization, in Romanian');
select is(pg_temp.slugs(public.search_coaches(p_query => 'powerlift')), 'cristi-pl', '7. by a specialization prefix');
select is(pg_temp.slugs(public.search_coaches(p_query => 'cluj')), 'ana-search', '8. by city');
-- a city typed in the search reads as a place (20261110130000): the coach located there first,
-- online coaches who serve everywhere after it, unrelated in-person coaches never
select is(pg_temp.slugs(public.search_coaches(p_query => 'Bucuresti')), 'cristi-pl,ana-search', '8. by city, without the diacritics: located first, online after');
select is((public.search_coaches(p_query => 'românia') ->> 'total')::int, 2, 'by country');
select is(pg_temp.slugs(public.search_coaches(p_query => 'meet prep')), 'cristi-pl', 'by service name');
select is(pg_temp.slugs(public.search_coaches(p_query => 'iron temple')), 'ana-search', 'by the gym a coach works at (20261026100000)');
select is(pg_temp.slugs(public.search_coaches(p_query => 'hypertrphy')), 'ana-search', 'a typo still finds the coach');
select is((public.search_coaches(p_query => 'zzzqqq') ->> 'total')::int, 0, 'nonsense finds nobody');
select is((public.search_coaches(p_query => $$'):*|!&$$) ->> 'total')::int, 2, 'tsquery syntax in the query is ignored');

-- ============================================================================
-- 3. filters
-- ============================================================================
select is(pg_temp.slugs(public.search_coaches(p_online => true, p_accepting => false, p_sort => 'newest')),
  'bogdan-fit,ana-search', '9. online');
select is(pg_temp.slugs(public.search_coaches(p_in_person => true, p_accepting => false, p_sort => 'newest')),
  'cristi-pl,ana-search', '10. in person');
select is((public.search_coaches(p_online => true, p_in_person => true, p_accepting => false) ->> 'total')::int, 3,
  'both formats ticked: either');
select is(pg_temp.slugs(public.search_coaches(p_accepting => true, p_sort => 'newest')), 'cristi-pl,ana-search',
  '11. accepting clients only');
select is(pg_temp.slugs(public.search_coaches(p_city => 'cluj-napoca', p_accepting => false)), 'ana-search', 'city filter');
select is(pg_temp.slugs(public.search_coaches(p_verified => true, p_accepting => false)), 'cristi-pl', 'verified only (20261027100000)');
select is((public.search_coaches(p_verified => false, p_accepting => false) ->> 'total')::int, 3, 'verified off is no filter');
select is(pg_temp.slugs(public.search_coaches(p_hybrid => true, p_accepting => false)), 'ana-search', 'hybrid: online and in person');
select is(pg_temp.slugs(public.search_coaches(p_gym => 'ce000000-0000-0000-0000-0000000000f1', p_accepting => false)), 'ana-search',
  'gym filter: the published coach there, not the draft one');
select is((public.search_coaches(p_gym => 'ce000000-0000-0000-0000-0000000000f2') ->> 'total')::int, 0, 'a gym with no coach: nobody');
select is(pg_temp.slugs(public.search_coaches(p_verified => true, p_in_person => true, p_specializations => array['powerlifting'],
                                              p_city => 'bucharest', p_min_years => 5)), 'cristi-pl', 'filters combine (AND)');
select is((public.search_coaches(p_verified => true, p_hybrid => true) ->> 'total')::int, 0, 'verified AND hybrid: nobody here');
select is((public.search_coaches(p_country => 'romania', p_accepting => false) ->> 'total')::int, 2,
  'country filter (an online-only coach has no location)');
select is(pg_temp.slugs(public.search_coaches(p_specializations => array['powerlifting', 'weight-loss'], p_accepting => false, p_sort => 'newest')),
  'cristi-pl,bogdan-fit', '12. several specializations: any of them');
select is(pg_temp.slugs(public.search_coaches(p_min_years => 10, p_accepting => false)), 'ana-search', 'experience 10+');
select is((public.search_coaches(p_min_years => 5, p_accepting => false) ->> 'total')::int, 2, 'experience 5+');
select is(pg_temp.slugs(public.search_coaches(p_price_min => 10000, p_price_max => 18000, p_accepting => false)), 'bogdan-fit',
  '13. price range, public prices only');
select is((public.search_coaches(p_price_min => 900000, p_accepting => false) ->> 'total')::int, 0,
  '13. a private price never matches a price filter');
select is(pg_temp.slugs(public.search_coaches(p_price_max => 6000, p_currency => 'EUR', p_accepting => false)), 'cristi-pl',
  'a price filter in another currency');
select is(public.search_coaches(p_query => 'ana_search') #> '{items,0,starting_price}',
  '{"cents": 20000, "currency": "RON", "unit": "month"}'::jsonb, 'the card''s starting price is the public one');
select is(pg_temp.slugs(public.search_coaches(p_query => 'hypertrophy', p_city => 'cluj-napoca', p_online => true,
                                              p_min_years => 5, p_price_max => 30000)),
  'ana-search', 'filters combine');

-- ============================================================================
-- 4. order and pages
-- ============================================================================
select is(pg_temp.slugs(public.search_coaches(p_accepting => false, p_sort => 'experience')), 'ana-search,cristi-pl,bogdan-fit',
  'most experienced first');
select is(public.search_coaches(p_accepting => false, p_sort => 'followers') #>> '{items,0,slug}', 'ana-search', 'most followed first');
select is(public.search_coaches(p_accepting => false, p_sort => 'newest') #>> '{items,0,slug}', 'cristi-pl', 'newest first');
select is(public.search_coaches(p_accepting => false) #>> '{items,2,slug}', 'bogdan-fit',
  'recommended: a coach who is not accepting comes last');
select is(public.search_coaches(p_accepting => false, p_sort => 'bogus') #>> '{items,2,slug}', 'bogdan-fit',
  'an unknown sort is recommended');
select is(jsonb_array_length(public.search_coaches(p_accepting => false, p_limit => 1) -> 'items'), 1, '14. a page of one');
select is((public.search_coaches(p_accepting => false, p_limit => 1, p_offset => 2) ->> 'total')::int, 3, '14. total is the whole result');
select is(pg_temp.slugs(public.search_coaches(p_accepting => false, p_sort => 'newest', p_limit => 1, p_offset => 1)), 'bogdan-fit',
  '14. the second page holds the second coach');
select is(jsonb_array_length(public.search_coaches(p_accepting => false, p_offset => 3) -> 'items'), 0, '14. past the end: empty');

-- ============================================================================
-- 5. facets
-- ============================================================================
select is((select (c ->> 'coaches')::int from jsonb_array_elements(public.coach_discovery_facets() -> 'cities') c
           where c ->> 'slug' = 'cluj-napoca'), 1, 'the Cluj facet counts only the published coach');
select is((select count(*)::int from jsonb_array_elements(public.coach_discovery_facets() -> 'cities')), 2,
  'only cities with a published coach are offered');
select ok(jsonb_array_length(public.coach_discovery_facets() -> 'specializations') >= 11, 'every active specialization is offered');
select is(public.coach_discovery_facets() -> 'gyms',
  '[{"id": "ce000000-0000-0000-0000-0000000000f1", "name": "Iron Temple Gym", "city": "cluj-napoca", "coaches": 1}]'::jsonb,
  'facets: active gyms with a published coach, counting only published ones');
select throws_ok($$ select public.coach_search_tsquery('x') $$, '42501', null, 'the tsquery helper is internal');

-- ============================================================================
-- 6. signed in: the same public data, minus anyone across a block
-- ============================================================================
reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000011');
select is((public.search_coaches(p_accepting => false) ->> 'total')::int, 3, 'a signed-in reader sees the same coaches');
-- the viewer keys (20261026100000): what a card's Follow button needs
create or replace function pg_temp.card(p_slug text) returns jsonb language sql as $fn$
  select i from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i where i ->> 'slug' = p_slug;
$fn$;
select is(pg_temp.card('ana-search') ->> 'user_id', 'ce000000-0000-0000-0000-00000000000a', 'a signed-in reader gets the coach''s user id');
select is(jsonb_build_object('is_self', pg_temp.card('ana-search') -> 'is_self', 'is_following', pg_temp.card('ana-search') -> 'is_following',
                             'follows_me', pg_temp.card('ana-search') -> 'follows_me'),
          '{"is_self": false, "is_following": true, "follows_me": false}'::jsonb, 'following a coach shows on their card');
select is(pg_temp.card('cristi-pl') ->> 'follows_me', 'true', 'a coach who follows the reader: follows_me');
select is(pg_temp.card('cristi-pl') ->> 'is_following', 'false', 'not followed back: is_following false');
reset role;
select pg_temp.authenticate_as('ce000000-0000-0000-0000-00000000000a');
select is(pg_temp.card('ana-search') ->> 'is_self', 'true', 'a coach''s own card says is_self');
reset role;
insert into public.social_user_blocks (blocker_id, blocked_id)
values ('ce000000-0000-0000-0000-00000000000a', 'ce000000-0000-0000-0000-000000000011');
select pg_temp.authenticate_as('ce000000-0000-0000-0000-000000000011');
select is(pg_temp.slugs(public.search_coaches(p_query => 'hypertrophy')), '', 'a coach who blocked the reader is not listed');

reset role;
-- a coach whose account is being deleted leaves search; a follower being deleted leaves the count
insert into public.account_deletion_requests (user_id) values ('ce000000-0000-0000-0000-00000000000b');
select pg_temp.anonymous();
select is((public.search_coaches(p_accepting => false) ->> 'total')::int, 2, 'a coach with a pending account deletion is not listed');
select is((public.search_coaches(p_query => 'Bogdan', p_accepting => false) ->> 'total')::int, 0, 'not even by name');
reset role;
insert into public.account_deletion_requests (user_id) values ('ce000000-0000-0000-0000-000000000011');
select pg_temp.anonymous();
select is((select (i ->> 'followers')::int from jsonb_array_elements(public.search_coaches(p_accepting => false) -> 'items') i
            where i ->> 'slug' = 'ana-search'), 0, 'a follower with a pending deletion is not counted');
reset role;
select * from finish();
rollback;
