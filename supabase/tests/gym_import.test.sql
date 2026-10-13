-- pgTAP · importing a city's gyms from Google (20261121100000).
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a4000000-0000-0000-0000-0000000000a1', 'admin@gi.local', '{"full_name":"Admin","username":"giadmin"}'),
  ('c4000000-0000-0000-0000-0000000000c1', 'cli@gi.local',   '{"full_name":"Cli","username":"gicli"}');
update public.users set role = 'admin' where id = 'a4000000-0000-0000-0000-0000000000a1';

create temp table places as select $j$[
  {"id": "ChIJ_one", "displayName": {"text": "Gym One"}, "formattedAddress": "Str. Unu 1, Cluj-Napoca",
   "location": {"latitude": 46.77, "longitude": 23.6}, "googleMapsUri": "https://maps.google.com/?cid=1",
   "rating": 4.4, "userRatingCount": 120, "nationalPhoneNumber": "0700 000 001"},
  {"id": "ChIJ_two", "displayName": {"text": "Gym Two"}, "location": {"latitude": 46.78, "longitude": 23.61}},
  {"id": "bad id!", "displayName": {"text": "Broken"}},
  {"id": "ChIJ_three", "displayName": {"text": "X"}}
]$j$::jsonb as j;
grant select on places to authenticated;

select pg_temp.authenticate_as('c4000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.admin_import_gyms((select j from places), 'Cluj-Napoca') $$, '42501', null,
  'only an admin imports');
select is(public.admin_known_place_ids(array['ChIJ_one']), '{}'::text[], 'a client learns nothing about known ids');

select pg_temp.authenticate_as('a4000000-0000-0000-0000-0000000000a1');
select is(public.admin_import_gyms((select j from places), 'Cluj-Napoca'), '{"imported": 2, "skipped": 2}'::jsonb,
  'two imported; a malformed id and a one-letter name skipped');
select is((select status || ' · ' || city || ' · ' || phone from public.gyms where google_place_id = 'ChIJ_one'),
  'active · Cluj-Napoca · 0700 000 001', 'active, in the city searched, with Google''s fields');
select is((select lat from public.gyms where google_place_id = 'ChIJ_two'), 46.78::double precision, 'the pin');
select is((select google_rating from public.gyms where google_place_id = 'ChIJ_one'), 4.4::numeric(2,1), 'the rating');
select is(public.admin_import_gyms((select j from places), 'Cluj-Napoca'), '{"imported": 0, "skipped": 4}'::jsonb,
  'importing again duplicates nothing');
select is(public.admin_known_place_ids(array['ChIJ_one', 'ChIJ_nope']), array['ChIJ_one'], 'the known ids');
select throws_ok($$ select public.admin_import_gyms('[]'::jsonb, '') $$, '22023', null, 'a city is required');

select * from finish();
rollback;
