-- pgTAP · Coach disciplines (20261116100000)
--
-- The taxonomy widened in place: every existing specialization kept (slug,
-- label, links), thirty-four new ones in six groups, one level of styles
-- under a discipline. A coach still picks through coach_set_specializations()
-- only (active slugs, at most eight, the primary among them). A filter on a
-- discipline finds its styles' coaches, once each, combined with the place and
-- format filters; facets count the same way; the card names the primary.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs coach_disciplines

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
create or replace function pg_temp.slugs(r jsonb) returns text[] language sql as $fn$
  select coalesce(array_agg(i ->> 'slug' order by i ->> 'slug'), '{}') from jsonb_array_elements(r -> 'items') i;
$fn$;
create or replace function pg_temp.facet(p_slug text) returns jsonb language sql as $fn$
  select f from jsonb_array_elements(public.coach_discovery_facets() -> 'specializations') f where f ->> 'slug' = p_slug;
$fn$;

-- ============================================================================
-- 1. the taxonomy: kept, widened, grouped, one level
-- ============================================================================
select is((select count(*)::int from public.specializations where active and slug = any (array[
  'weight-loss', 'muscle-building', 'hypertrophy', 'strength', 'powerlifting', 'bodybuilding',
  'functional-training', 'mobility', 'sports-performance', 'nutrition', 'beginners'])), 11,
  'all eleven existing specializations are still there and active');
select is((select count(*)::int from public.specializations where active and slug = any (array[
  'general-fitness', 'body-recomposition', 'strength-conditioning', 'sports-specific-conditioning',
  'yoga', 'hatha-yoga', 'vinyasa-yoga', 'yin-yoga', 'ashtanga-yoga', 'pilates', 'mat-pilates', 'reformer-pilates', 'posture-movement',
  'trx-suspension-training', 'hiit', 'circuit-training', 'calisthenics', 'kettlebell-training',
  'running', 'marathon-preparation', 'cycling', 'swimming', 'triathlon', 'hiking-outdoor-fitness',
  'boxing', 'kickboxing', 'muay-thai', 'brazilian-jiu-jitsu', 'wrestling', 'martial-arts',
  'dance-fitness', 'prenatal-postnatal-fitness', 'senior-fitness', 'youth-athletic-development'])), 34,
  'the thirty-four new disciplines exist');
select is((select count(*)::int from public.specializations
            where category not in ('strength', 'mind_body', 'functional', 'endurance', 'combat', 'other')), 0,
  'every specialization is in one of the six groups');
select is((select array_agg(distinct category order by category) from public.specializations where active),
  array['combat', 'endurance', 'functional', 'mind_body', 'other', 'strength'], 'all six groups are in use');
select is((select name_en || ' / ' || name_ro from public.specializations where slug = 'mobility'),
  'Mobility & Flexibility / Mobilitate și flexibilitate', 'mobility: relabelled, same slug');
select is((select name_en from public.specializations where slug = 'strength'), 'Strength', 'other labels are untouched');
select is((select p.slug from public.specializations s join public.specializations p on p.id = s.parent_id where s.slug = 'hypertrophy'),
  'muscle-building', 'hypertrophy is a style of muscle building');
select is((select p.slug from public.specializations s join public.specializations p on p.id = s.parent_id where s.slug = 'vinyasa-yoga'),
  'yoga', 'vinyasa is a style of yoga');
select is((select count(*)::int from public.specializations s join public.specializations p on p.id = s.parent_id
            where p.parent_id is not null or p.category <> s.category), 0, 'one level, and a style shares its discipline''s group');
select is((select count(*)::int from public.specializations
            where slug ~ '(rehab|physio|therap|clinic|medical)' or name_en ~* '(rehab|physio|therap|clinic|medical)'), 0,
  'nothing clinical in the taxonomy');
select throws_ok($$ update public.specializations set parent_id = (select id from public.specializations where slug = 'hatha-yoga')
                    where slug = 'yin-yoga' $$, '23514', 'SPECIALIZATION_ONE_LEVEL', 'a style cannot hang under a style');
select throws_ok($$ update public.specializations set parent_id = (select id from public.specializations where slug = 'running')
                    where slug = 'boxing' $$, '23514', 'SPECIALIZATION_PARENT_CATEGORY', 'a style stays in its discipline''s group');
select throws_ok($$ update public.specializations set parent_id = (select id from public.specializations where slug = 'pilates')
                    where slug = 'yoga' $$, '23514', 'SPECIALIZATION_ONE_LEVEL', 'a discipline with styles cannot become a style');
select throws_ok($$ update public.specializations set parent_id = id where slug = 'cycling' $$,
  '23514', null, 'nothing is its own parent');
select throws_ok($$ update public.specializations set category = 'combat' where slug = 'yoga' $$,
  '23514', 'SPECIALIZATION_PARENT_CATEGORY', 'a discipline cannot leave its styles in another group');
select ok(public.coach_slug_reserved('yoga') and public.coach_slug_reserved('brazilian-jiu-jitsu'),
  'a coach cannot take a discipline''s slug');

-- ============================================================================
-- fixtures: five published coaches, one draft, one client
-- ============================================================================
-- 01 yoga_par (Yoga, online, Cluj) · 02 vin_only (Vinyasa, in person, Cluj) · 03 both_yoga (Yoga + Hatha★, online, Bucharest)
-- 04 boxer_df (Boxing, online) · 05 legacy_df (Strength★ + Hypertrophy, the old rows) · 06 draft_df · c1 a client
insert into auth.users (id, email, raw_user_meta_data)
select ('de000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, u || '@df.local',
       json_build_object('full_name', initcap(u), 'username', u)::jsonb
from (values (1, 'yoga_par'), (2, 'vin_only'), (3, 'both_yoga'), (4, 'boxer_df'), (5, 'legacy_df'), (6, 'draft_df')) v(n, u);
insert into auth.users (id, email, raw_user_meta_data) values
  ('de000000-0000-0000-0000-0000000000c1', 'client@df.local', '{"full_name":"Client","username":"df_client"}');

do $$
declare r record;
begin
  for r in select id from auth.users where email like '%@df.local' and email <> 'client@df.local' loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.id::text, 'role', 'authenticated')::text, true);
    perform public.become_coach();
  end loop;
end;
$$;
update public.coach_profiles set headline = 'Coach', online = true, in_person = false, accepting_clients = true
 where user_id in (select id from auth.users where email like '%@df.local');
update public.coach_profiles set online = false, in_person = true, headline = 'Vinyasa flow teacher' where slug = 'vin-only';
insert into public.coach_locations (coach_profile_id, city_id)
select cp.id, c.id from (values ('yoga-par', 'cluj-napoca'), ('vin-only', 'cluj-napoca'), ('both-yoga', 'bucharest')) v(coach, city)
join public.coach_profiles cp on cp.slug = v.coach join public.cities c on c.slug = v.city;
insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
select cp.id, s.id, v.primary_
from (values ('yoga-par', 'yoga', true), ('vin-only', 'vinyasa-yoga', true), ('both-yoga', 'yoga', false), ('both-yoga', 'hatha-yoga', true),
             ('boxer-df', 'boxing', true), ('legacy-df', 'strength', true), ('legacy-df', 'hypertrophy', false),
             ('draft-df', 'yoga', true)) v(coach, spec, primary_)
join public.coach_profiles cp on cp.slug = v.coach join public.specializations s on s.slug = v.spec;
update public.coach_profiles set status = 'published', published_at = now() - interval '30 days'
 where user_id in (select id from auth.users where email like '%@df.local') and slug <> 'draft-df';

-- ============================================================================
-- 2. choosing: the one write path, validated on the server
-- ============================================================================
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000006');
select lives_ok($$ select public.coach_set_specializations(array['yoga', 'vinyasa-yoga', 'boxing'], 'vinyasa-yoga') $$,
  'a coach picks a discipline, one of its styles and one from another group');
select is((select array_agg(s.slug || ':' || cs.is_primary order by s.slug) from public.coach_specializations cs
             join public.specializations s on s.id = cs.specialization_id
             join public.coach_profiles cp on cp.id = cs.coach_profile_id where cp.slug = 'draft-df'),
  array['boxing:false', 'vinyasa-yoga:true', 'yoga:false'], '… all three stored, the starred one primary');
select throws_ok($$ select public.coach_set_specializations(array['yoga', 'yoga-on-mars']) $$,
  '22023', 'UNKNOWN_SPECIALIZATION', 'a slug outside the taxonomy is refused');
select throws_ok($$ select public.coach_set_specializations(array['yoga'], 'boxing') $$,
  '22023', 'UNKNOWN_SPECIALIZATION', 'a primary that is not among the picks is refused');
select throws_ok($$ select public.coach_set_specializations(array['yoga', 'hatha-yoga', 'vinyasa-yoga', 'yin-yoga', 'ashtanga-yoga',
                                                                 'pilates', 'mat-pilates', 'reformer-pilates', 'boxing']) $$,
  '22023', 'TOO_MANY_SPECIALIZATIONS', 'still eight at most');
select is((select count(*)::int from public.coach_specializations cs join public.coach_profiles cp on cp.id = cs.coach_profile_id
            where cp.slug = 'draft-df'), 3, 'a refused save changes nothing');
select throws_ok($$ insert into public.coach_specializations (coach_profile_id, specialization_id)
                    select cp.id, s.id from public.coach_profiles cp, public.specializations s where cp.slug = 'draft-df' and s.slug = 'cycling' $$,
  '42501', null, 'no direct write around the validation');
update public.specializations set name_en = 'Anything' where slug = 'yoga';
reset role;
select is((select name_en from public.specializations where slug = 'yoga'), 'Yoga', 'a coach cannot edit the taxonomy');
-- a retired specialization cannot be picked any more
insert into public.specializations (slug, name_en, name_ro, category, active) values ('retired-df', 'Retired', 'Retras', 'other', false);
select pg_temp.authenticate_as('de000000-0000-0000-0000-000000000006');
select throws_ok($$ select public.coach_set_specializations(array['retired-df']) $$,
  '22023', 'UNKNOWN_SPECIALIZATION', 'a retired specialization is refused');
reset role;
select pg_temp.authenticate_as('de000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.coach_set_specializations(array['yoga']) $$, null, null, 'a client has no coach profile to tag');
reset role;

-- ============================================================================
-- 3. finding: a discipline includes its styles, once per coach
-- ============================================================================
select pg_temp.anonymous();
select is(pg_temp.slugs(public.search_coaches(p_specializations => array['yoga'])),
  array['both-yoga', 'vin-only', 'yoga-par'], 'Yoga finds the yoga coach, the Vinyasa-only coach and the Hatha coach');
select is((public.search_coaches(p_specializations => array['yoga', 'hatha-yoga']) ->> 'total')::int, 3,
  'a coach matching two picked specializations counts once');
select is((select count(*)::int from jsonb_array_elements(public.search_coaches(p_specializations => array['yoga', 'hatha-yoga', 'vinyasa-yoga']) -> 'items')), 3,
  '… and is listed once');
select is(pg_temp.slugs(public.search_coaches(p_specializations => array['vinyasa-yoga'])), array['vin-only'],
  'a style does not widen to its discipline');
select is(pg_temp.slugs(public.search_coaches(p_specializations => array['yoga'], p_in_person => true)), array['vin-only'],
  'combined with in person');
select is(pg_temp.slugs(public.search_coaches(p_specializations => array['yoga'], p_online => true)), array['both-yoga', 'yoga-par'],
  'combined with online');
select ok(not ('vin-only' = any (pg_temp.slugs(public.search_coaches(p_specializations => array['yoga'], p_city => 'bucharest'))))
          and 'both-yoga' = any (pg_temp.slugs(public.search_coaches(p_specializations => array['yoga'], p_city => 'bucharest'))),
  'combined with a city: the in-person coach elsewhere is not there');
select is((select jsonb_build_array(r ->> 'total', jsonb_array_length(r -> 'items'))
             from (select public.search_coaches(p_specializations => array['yoga'], p_limit => 1) r) x),
  '["3", 1]'::jsonb, 'paginated: the total is the whole result, the page one card');
select is(pg_temp.slugs(public.search_coaches(p_specializations => array['muscle-building'])), array['legacy-df'],
  'a legacy Hypertrophy coach is found under Muscle Building');
select is(pg_temp.slugs(public.search_coaches(p_specializations => array['cycling'])), '{}'::text[],
  'a discipline nobody offers yet: an empty result, no error');
select ok(not ('draft-df' = any (pg_temp.slugs(public.search_coaches(p_specializations => array['yoga'], p_limit => 50)))),
  'a draft stays out of the results');
select is((select i ->> 'slug' from jsonb_array_elements(public.search_coaches(p_query => 'vinyasa') -> 'items') with ordinality t(i, o)
            where o = 1), 'vin-only', 'free text finds a style by its name');

-- ============================================================================
-- 4. what is shown: facets, the card's primary, the public page
-- ============================================================================
select is((pg_temp.facet('yoga') ->> 'coaches')::int, 3, 'facets: Yoga counts its styles'' coaches, each once');
select is((pg_temp.facet('vinyasa-yoga') ->> 'coaches')::int, 1, 'facets: a style counts its own');
select is((pg_temp.facet('cycling') ->> 'coaches')::int, 0, 'facets: nobody offers cycling yet');
select is(pg_temp.facet('vinyasa-yoga') ->> 'parent', 'yoga', 'facets: a style names its discipline');
select is(pg_temp.facet('boxing') ->> 'category', 'combat', 'facets: the group');
select ok(pg_temp.facet('retired-df') is null, 'facets: a retired specialization is not offered');
select is((select jsonb_agg(s - 'name_en' - 'name_ro') from jsonb_array_elements(
             (select i from jsonb_array_elements(public.search_coaches(p_specializations => array['hatha-yoga']) -> 'items') i
               where i ->> 'slug' = 'both-yoga') -> 'specializations') s),
  '[{"slug": "hatha-yoga", "is_primary": true}, {"slug": "yoga", "is_primary": false}]'::jsonb,
  'the card lists the primary first and says it is the primary');
select is((select (i ->> 'specializations_total')::int from jsonb_array_elements(public.search_coaches(p_specializations => array['strength']) -> 'items') i
            where i ->> 'slug' = 'legacy-df'), 2, 'a legacy coach keeps both specializations');
select is((select count(*)::int from jsonb_array_elements(public.coach_public_profile('vin-only') -> 'specializations') s
            where s ->> 'slug' = 'vinyasa-yoga' and (s ->> 'is_primary')::boolean), 1, 'the public page shows the style as primary');
reset role;

select * from finish();
rollback;
