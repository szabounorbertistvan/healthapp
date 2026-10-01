-- pgTAP · foods are found one search at a time, not listed: the shared library
-- is readable only where a user already references a row, search goes through
-- search_foods() with a daily cap, and other people's custom foods never show.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f5000000-0000-0000-0000-000000000001', 'client@foodsearch.local', '{"full_name":"Client","username":"fs_client"}'),
  ('f5000000-0000-0000-0000-000000000002', 'other@foodsearch.local',  '{"full_name":"Other","username":"fs_other"}'),
  ('f5000000-0000-0000-0000-000000000003', 'admin@foodsearch.local',  '{"full_name":"Admin","username":"fs_admin"}');
update public.users set role = 'admin' where id = 'f5000000-0000-0000-0000-000000000003';

-- library rows: two USDA generics (one named in Romanian), one custom of "other"
insert into public.foods (id, source, external_id, name_en, name_ro, kcal_100g, protein_100g, carbs_100g, fat_100g, verified) values
  ('f5000000-0000-0000-0000-00000000a001', 'usda', 'fs:1', 'Chicken, breast, raw', 'Piept de pui', 120, 22.5, 0, 2.6, true),
  ('f5000000-0000-0000-0000-00000000a002', 'usda', 'fs:2', 'Chicken, thigh, raw',  null,           177, 17.3, 0, 11.6, true);
insert into public.foods (id, source, owner_id, name_en, name_ro, kcal_100g) values
  ('f5000000-0000-0000-0000-00000000a003', 'custom', 'f5000000-0000-0000-0000-000000000002', 'Other''s chicken soup', 'Supa altcuiva', 50);

-- the client's plan references the first USDA row
insert into public.nutrition_plans (id, client_id, name, kcal_target, status)
  values ('f5000000-0000-0000-0000-00000000b001', 'f5000000-0000-0000-0000-000000000001', 'Plan', 2000, 'published');
insert into public.planned_meals (id, plan_id, slot, name)
  values ('f5000000-0000-0000-0000-00000000c001', 'f5000000-0000-0000-0000-00000000b001', 'lunch', 'Lunch');
insert into public.planned_meal_foods (planned_meal_id, food_id, grams)
  values ('f5000000-0000-0000-0000-00000000c001', 'f5000000-0000-0000-0000-00000000a001', 150);

select pg_temp.authenticate_as('f5000000-0000-0000-0000-000000000001');

-- 1-2  the table is no longer a list
select is(
  (select count(*)::int from public.foods where id in (
     'f5000000-0000-0000-0000-00000000a001', 'f5000000-0000-0000-0000-00000000a002', 'f5000000-0000-0000-0000-00000000a003')),
  1, 'a client reads only the food their plan references');
select is(
  (select name_ro from public.foods where id = 'f5000000-0000-0000-0000-00000000a001'),
  'Piept de pui', 'the referenced row comes with its Romanian name');

-- 3-6  search works, in Romanian-first order, within limits
select is(
  (select count(*)::int from public.search_foods('chicken')), 2,
  'search finds the library rows (and not another user''s custom)');
select is(
  (select name_ro from public.search_foods('chicken') limit 1),
  'Piept de pui', 'Romanian-named rows come first');
select is((select count(*)::int from public.search_foods('c')), 0, 'one character returns nothing');
select is((select count(*)::int from public.search_foods('chicken', 1)), 1, 'the limit is honoured');
select is((select count(*)::int from public.search_foods('%')), 0, 'LIKE metacharacters are not wildcards');

-- 8  single-row read for a food not referenced yet
select is(
  (select name_en from public.food_by_id('f5000000-0000-0000-0000-00000000a002')),
  'Chicken, thigh, raw', 'food_by_id reaches an unreferenced library row');
select is(
  (select count(*)::int from public.food_by_id('f5000000-0000-0000-0000-00000000a003')),
  0, 'food_by_id never returns another user''s custom');

-- 10  the daily cap
reset role;
update public.food_search_quota set hits = 400
 where user_id = 'f5000000-0000-0000-0000-000000000001' and day = current_date;
select pg_temp.authenticate_as('f5000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select * from public.search_foods('chicken') $$,
  'P0001', 'FOOD_SEARCH_RATE', 'the 401st search of the day is refused');

-- 11  the quota table itself is not readable
select is((select count(*)::int from public.food_search_quota), 0, 'the quota table is invisible to users');

-- 12  an admin still sees the whole library
select pg_temp.authenticate_as('f5000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from public.foods where id in (
     'f5000000-0000-0000-0000-00000000a001', 'f5000000-0000-0000-0000-00000000a002', 'f5000000-0000-0000-0000-00000000a003')),
  3, 'an admin reads every row');

select * from finish();
rollback;
