-- pgTAP · gym map and stats (20261117100000): where a workout happened, the
-- three-people floor on every gym number, gym tops, one gym's stats, the map,
-- and the admin's Google place data.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a2000000-0000-0000-0000-0000000000a1', 'admin@gs.local', '{"full_name":"Admin","username":"gsadmin"}'),
  ('e1000000-0000-0000-0000-0000000000e1', 'p1@gs.local', '{"full_name":"P1","username":"gsp1"}'),
  ('e2000000-0000-0000-0000-0000000000e2', 'p2@gs.local', '{"full_name":"P2","username":"gsp2"}'),
  ('e3000000-0000-0000-0000-0000000000e3', 'p3@gs.local', '{"full_name":"P3","username":"gsp3"}'),
  ('e4000000-0000-0000-0000-0000000000e4', 'p4@gs.local', '{"full_name":"P4","username":"gsp4"}');
update public.users set role = 'admin' where id = 'a2000000-0000-0000-0000-0000000000a1';
insert into public.exercises (id, name_en, name_ro, source) values
  ('e9000000-0000-0000-0000-0000000000ee', 'Bench', 'Impins', 'custom');

select pg_temp.authenticate_as('a2000000-0000-0000-0000-0000000000a1');
create temp table g as select
  public.admin_save_gym(null, 'Big Gym', 'Cluj-Napoca', null, 46.77, 23.6) as big,
  public.admin_save_gym(null, 'Small Gym', 'Cluj-Napoca', null, 46.78, 23.61) as small,
  public.admin_save_gym(null, 'Far Gym', 'Iasi', null, 47.15, 27.6) as far;
grant select on g to authenticated;
reset role;
insert into public.gyms (name, city, status) values ('Pending Gym', 'Cluj-Napoca', 'pending');
create temp table pend as select id from public.gyms where name = 'Pending Gym';
grant select on pend to authenticated;

-- A completed session at a gym, 5 sets of 100 × 10, `p_hours` ago.
create or replace function pg_temp.session(p_user uuid, p_gym uuid, p_hours int default 1)
returns uuid language plpgsql as $fn$
declare v_id uuid; i int;
begin
  insert into public.logged_sessions (user_id, client_generated_id, started_at, completed_at, gym_id)
  values (p_user, gen_random_uuid(), now() - make_interval(hours => p_hours), now() - make_interval(hours => p_hours - 1), p_gym)
  returning id into v_id;
  for i in 1..5 loop
    insert into public.logged_sets (session_id, user_id, exercise_id, set_index, weight_kg, reps, rpe, client_generated_id)
    values (v_id, p_user, 'e9000000-0000-0000-0000-0000000000ee', i, 100, 10, 8, gen_random_uuid());
  end loop;
  return v_id;
end;
$fn$;
-- Big Gym: four people, five workouts. Small Gym: two people only.
select pg_temp.session('e1000000-0000-0000-0000-0000000000e1', (select big from g));
select pg_temp.session('e1000000-0000-0000-0000-0000000000e1', (select big from g), 3);
select pg_temp.session('e2000000-0000-0000-0000-0000000000e2', (select big from g));
select pg_temp.session('e3000000-0000-0000-0000-0000000000e3', (select big from g));
select pg_temp.session('e4000000-0000-0000-0000-0000000000e4', (select big from g));
select pg_temp.session('e1000000-0000-0000-0000-0000000000e1', (select small from g), 5);
select pg_temp.session('e2000000-0000-0000-0000-0000000000e2', (select small from g), 5);
update public.users set home_gym_id = (select big from g)
 where id in ('e1000000-0000-0000-0000-0000000000e1', 'e2000000-0000-0000-0000-0000000000e2', 'e3000000-0000-0000-0000-0000000000e3');

-- ---------- 1. where a workout happened ----------
select pg_temp.authenticate_as('e4000000-0000-0000-0000-0000000000e4');
create temp table mine as
  select id from public.logged_sessions where user_id = 'e4000000-0000-0000-0000-0000000000e4' limit 1;
grant select on mine to authenticated;
select lives_ok($$ update public.logged_sessions set gym_id = (select far from g) where id = (select id from mine) $$,
  'the owner moves their session to another gym');
select is((select gym_id from public.logged_sessions where id = (select id from mine)), (select far from g),
  'and it is stored');
select throws_ok($$ update public.logged_sessions set gym_id = (select id from pend)
                   where id = (select id from mine) $$, 'P0002', null, 'a pending gym is refused');
select lives_ok($$ update public.logged_sessions set gym_id = (select big from g) where id = (select id from mine) $$,
  'back to Big Gym');
select is((select count(*)::int from public.logged_sessions
           where user_id = 'e1000000-0000-0000-0000-0000000000e1'), 0,
  'nobody else''s sessions are readable, so none can be moved');
select is((select array_agg(name) from public.my_recent_gyms()), array['Big Gym'], 'my recent gyms');

-- ---------- 2. tops and the three-people floor (admin only since 20261117110000) ----------
select throws_ok($$ select * from public.gym_tops('workouts', 'all') $$, '42501', null, 'a client cannot read gym-vs-gym tops');
select throws_ok($$ select * from public.admin_gym_tops('workouts', 'all') $$, '42501', null, 'nor through the admin door');
select pg_temp.authenticate_as('a2000000-0000-0000-0000-0000000000a1');
select is((select array_agg(name order by rank) from public.admin_gym_tops('workouts', 'all')), array['Big Gym'],
  'only a gym with three people behind it is ranked (Small Gym has two)');
select is((select score from public.admin_gym_tops('workouts', 'all') where name = 'Big Gym'), 5::numeric,
  'Big Gym: five workouts');
select is((select athletes from public.admin_gym_tops('athletes', 'all') where name = 'Big Gym'), 4, 'four people trained there');
select is((select score from public.admin_gym_tops('volume', 'all') where name = 'Big Gym'), 25000::numeric,
  'volume: 5 sessions × 5 sets × 1000 kg');
select is((select score from public.admin_gym_tops('members', 'all') where name = 'Big Gym'), 3::numeric,
  'members: three have it as their gym');
select is((select count(*)::int from public.admin_gym_tops('workouts', 'all', 'iasi')), 0, 'a city filter');
select is((select count(*)::int from public.admin_gym_tops('workouts', 'all', 'CLUJ-NAPOCA')), 1, 'case-insensitive city');
select throws_ok($$ select * from public.admin_gym_tops('calories', 'all') $$, '22023', null, 'an unknown metric is refused');
select throws_ok($$ select * from public.admin_gym_tops('workouts', 'year') $$, '22023', null, 'an unknown period is refused');

select pg_temp.authenticate_as('e4000000-0000-0000-0000-0000000000e4');

-- ---------- 3. one gym's stats ----------
select is((public.gym_stats((select big from g)) -> 'month' ->> 'athletes')::int, 4, 'Big Gym: four people this month');
select is(jsonb_array_length(public.gym_stats((select big from g)) -> 'busy_hours'), 24, 'busiest hours: 24 buckets');
select is(jsonb_array_length(public.gym_stats((select big from g)) -> 'busy_days'), 7, 'busiest days: 7 buckets');
select is((public.gym_stats((select big from g)) ->> 'rank_month')::int, 1, 'first in the month''s top');
select is((public.gym_stats((select big from g)) ->> 'my_month')::int, 1, 'the caller''s own workouts there');
select is(public.gym_stats((select small from g)) -> 'month', 'null'::jsonb, 'Small Gym: no month figures below three people');
select is(public.gym_stats((select small from g)) -> 'busy_hours', 'null'::jsonb, 'and no busy hours');
select is(public.gym_stats((select id from pend)), null, 'a pending gym has no stats');

-- ---------- 4. the map ----------
select is((select count(*)::int from public.gyms_map()), 3, 'every active gym with coordinates');
select is((select athletes_30d from public.gyms_map() where name = 'Big Gym'), 4, 'a pin shows people from three up');
select is((select athletes_30d from public.gyms_map() where name = 'Small Gym'), null, 'and nothing below');

-- ---------- 5. Google data (admin only) ----------
select throws_ok($$ select public.admin_set_gym_google((select big from g), '{"id":"ChIJabc"}'::jsonb) $$, '42501', null,
  'only an admin stores Google data');
select pg_temp.authenticate_as('a2000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.admin_set_gym_google((select big from g), $j${
  "id": "ChIJ_abc-123", "rating": 4.66, "userRatingCount": 210, "businessStatus": "OPERATIONAL",
  "regularOpeningHours": {"weekdayDescriptions": ["luni: 06:00–23:00"], "periods": [{"open": {"day": 1, "hour": 6, "minute": 0}, "close": {"day": 1, "hour": 23, "minute": 0}}]},
  "nationalPhoneNumber": "0264 000 000", "websiteUri": "https://big.example", "types": ["gym", "health"], "primaryType": "gym",
  "editorialSummary": {"text": "A big gym."}, "parkingOptions": {"freeParkingLot": true, "evil": "x"},
  "photos": [{"name": "places/ChIJ_abc-123/photos/AbC_1", "authorAttributions": [{"displayName": "Ion"}]}]
}$j$::jsonb) $$, 'an admin stores a Places (New) object');
select is((select google_rating from public.gyms where id = (select big from g)), 4.7::numeric(2,1), 'rounded rating');
select is((select phone || ' · ' || website || ' · ' || primary_type from public.gyms where id = (select big from g)),
  '0264 000 000 · https://big.example · gym', 'phone, website, primary type');
select is((select parking from public.gyms where id = (select big from g)), '{"freeParkingLot": true}'::jsonb,
  'option blocks keep booleans only');
select is((select photo_name from public.gyms where id = (select big from g)), 'places/ChIJ_abc-123/photos/AbC_1', 'the photo resource name');
select is((public.gym_stats((select big from g)) -> 'gym' ->> 'has_photo')::boolean, true, 'stats say there is a photo, not its name');
select throws_ok($$ select public.admin_set_gym_google((select big from g), '{"id":"bad id!"}'::jsonb) $$, '22023', null,
  'a malformed place id is refused');
select lives_ok($$ select public.admin_set_gym_google((select big from g), null) $$, 'null clears the link');
select is((select google_place_id is null and phone is null and photo_name is null from public.gyms where id = (select big from g)), true,
  'and every Google field with it');
reset role;
select is(public.gym_google_refresh_request(), 0, 'no Vault key: the monthly refresh does nothing');

select * from finish();
rollback;
