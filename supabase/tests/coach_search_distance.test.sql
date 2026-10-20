-- pgTAP · coach search by distance (20261207140000)

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;
create or replace function pg_temp.slugs(r jsonb) returns text language sql as $fn$
  select coalesce(string_agg(i ->> 'slug', ',' order by o), '') from jsonb_array_elements(r -> 'items') with ordinality as t(i, o);
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-00000000000a', 'cluj@dist.local', '{"full_name":"Cluj","username":"cluj_dist"}'),
  ('d1000000-0000-0000-0000-00000000000b', 'buc@dist.local',  '{"full_name":"Buc","username":"buc_dist"}'),
  ('d1000000-0000-0000-0000-00000000000c', 'web@dist.local',  '{"full_name":"Web","username":"web_dist"}');

select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000a'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000b'); select public.become_coach(); reset role;
select pg_temp.authenticate_as('d1000000-0000-0000-0000-00000000000c'); select public.become_coach(); reset role;

update public.coach_profiles set status = 'published', published_at = now(), in_person = true, headline = 'Coach'
 where slug in ('cluj-dist', 'buc-dist');
update public.coach_profiles set status = 'published', published_at = now(), online = true, headline = 'Coach'
 where slug = 'web-dist';
insert into public.coach_locations (coach_profile_id, city_id)
select cp.id, c.id from public.coach_profiles cp, public.cities c where cp.slug = 'cluj-dist' and c.slug = 'cluj-napoca';
insert into public.coach_locations (coach_profile_id, city_id)
select cp.id, c.id from public.coach_profiles cp, public.cities c where cp.slug = 'buc-dist' and c.slug = 'bucharest';

-- a reader standing in Cluj (Piața Unirii)
-- 1  nearest first
select is(pg_temp.slugs(public.search_coaches(p_sort => 'distance', p_near_lat => 46.7697, p_near_lng => 23.5898)),
  'cluj-dist,buc-dist,web-dist', 'sorted by distance: Cluj, then Bucharest, then a coach with no place');

-- 2  a radius keeps only the coaches inside it
select is(pg_temp.slugs(public.search_coaches(p_near_lat => 46.7697, p_near_lng => 23.5898, p_radius_km => 50)),
  'cluj-dist', 'a 50 km radius around Cluj keeps only the Cluj coach');

-- 3-4  the card carries a rounded distance only when a point was sent
select ok((select (i ->> 'distance_km')::numeric between 2 and 5
             from jsonb_array_elements(public.search_coaches(p_near_lat => 46.7697, p_near_lng => 23.5898, p_radius_km => 50) -> 'items') i),
  'the Cluj coach is a few km from the centre (city-level, from the city''s centre)');
select ok((select bool_and(i -> 'distance_km' = 'null'::jsonb)
             from jsonb_array_elements(public.search_coaches() -> 'items') i),
  'without a point no card carries a distance');

-- 5  Bucharest is ~320 km from Cluj
select ok((select (i ->> 'distance_km')::numeric between 300 and 350
             from jsonb_array_elements(public.search_coaches(p_near_lat => 46.7697, p_near_lng => 23.5898) -> 'items') i
            where i ->> 'slug' = 'buc-dist'),
  'Cluj to Bucharest is about 320 km as the crow flies');

-- 6  a nonsense point is ignored, not an error
select is((public.search_coaches(p_near_lat => 500, p_near_lng => 23, p_radius_km => 10) ->> 'total')::int, 3,
  'an impossible point is ignored');

-- 7-8  the door stays open to anonymous readers; the helper is internal
select ok(has_function_privilege('anon', 'public.search_coaches(text, text, text, boolean, boolean, text[], int, int, int, text, boolean, text, int, int, boolean, boolean, uuid, boolean, text[], text[], numeric, boolean, numeric, numeric, int)', 'execute'),
  'anonymous readers may search by distance');
select ok(not has_function_privilege('anon', 'public.coach_distance_km(uuid, numeric, numeric)', 'execute')
          and not has_function_privilege('authenticated', 'public.coach_distance_km(uuid, numeric, numeric)', 'execute'),
  'coach_distance_km is internal');

select * from finish();
rollback;
