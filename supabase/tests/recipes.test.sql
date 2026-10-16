-- pgTAP · recipes (20261201100000): owner-only recipes and lines, the caps,
-- and the two food lookups keep foods unlistable.
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ca000000-0000-0000-0000-000000000001', 'a@rc.local', '{"full_name":"A"}'),
  ('ca000000-0000-0000-0000-000000000002', 'b@rc.local', '{"full_name":"B"}');
insert into public.foods (id, source, external_id, name_en, name_ro, kcal_100g, protein_100g, carbs_100g, fat_100g, dishfinder_ingredient_id) values
  ('cb000000-0000-0000-0000-000000000001', 'usda', 'rc-1', 'Sauerkraut', 'Varză murată', 19, 0.9, 4.3, 0.1, 9001),
  ('cb000000-0000-0000-0000-000000000002', 'usda', 'rc-2', 'Rice, raw', 'Orez', 360, 7, 79, 0.6, 9002);
insert into public.foods (id, source, external_id, owner_id, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g, dishfinder_ingredient_id) values
  ('cb000000-0000-0000-0000-000000000003', 'custom', 'rc-3', 'ca000000-0000-0000-0000-000000000002', 'B secret food', 100, 1, 1, 1, 9001);

-- ---------- owner writes and reads ----------
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
insert into public.recipes (id, owner_id, title, servings, serving_grams, kcal_serving, protein_serving, carbs_serving, fat_serving, nutrition_source, dishfinder_recipe_id, dishfinder_url)
values ('cc000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', 'Sarmale', 40, 80, 123, 5.8, 6.3, 8.4, 'dishfinder', 99648, 'https://dishfinder.ro/cooking/99648');
insert into public.recipe_ingredients (recipe_id, position, label, food_id, grams, dishfinder_ingredient_id)
values ('cc000000-0000-0000-0000-000000000001', 0, '1,5 kg varză murată', 'cb000000-0000-0000-0000-000000000001', 1500, 9001);
select is((select count(*)::int from public.recipes), 1, 'the owner reads their recipe');
select is((select count(*)::int from public.recipe_ingredients), 1, '...and its lines');
select throws_ok($$
  insert into public.recipes (owner_id, title, servings, serving_grams, kcal_serving, nutrition_source)
  values ('ca000000-0000-0000-0000-000000000002', 'Forged', 1, 100, 100, 'voinic')
$$, '42501', null, 'nobody writes a recipe in someone else''s name');
select throws_ok($$
  insert into public.recipes (owner_id, title, servings, serving_grams, kcal_serving, nutrition_source, dishfinder_url)
  values ('ca000000-0000-0000-0000-000000000001', 'Bad link', 1, 100, 100, 'dishfinder', 'javascript:alert(1)')
$$, '23514', null, 'a link back must be https');
select throws_ok($$
  insert into public.recipes (owner_id, title, servings, serving_grams, kcal_serving, nutrition_source)
  values ('ca000000-0000-0000-0000-000000000001', 'Zero', 1, 0, 100, 'voinic')
$$, '23514', null, 'a serving has a weight');

-- ---------- someone else ----------
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.recipes), 0, 'another person sees no recipe');
select is((select count(*)::int from public.recipe_ingredients), 0, '...and no line');
select lives_ok($$ update public.recipes set title = 'Mine now' $$, 'an update on someone else''s recipe is filtered...');
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select is((select title from public.recipes), 'Sarmale', '...and changes nothing');
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000002');
select throws_ok($$
  insert into public.recipe_ingredients (recipe_id, position, label)
  values ('cc000000-0000-0000-0000-000000000001', 1, 'smuggled line')
$$, '42501', null, 'nobody adds a line to someone else''s recipe');

-- ---------- food lookups ----------
select pg_temp.authenticate_as('ca000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.foods_by_dishfinder_ids(array[9001, 9002])), 2,
  'foods_by_dishfinder_ids finds the shared foods by DishFinder id');
select is((select count(*)::int from public.foods_by_dishfinder_ids(array[9001]) where name_en = 'B secret food'), 0,
  '...never someone else''s custom food');
select is((select count(*)::int from public.foods_by_ids(array['cb000000-0000-0000-0000-000000000003'::uuid])), 0,
  'foods_by_ids hides someone else''s custom food too');
select is((select kcal_100g from public.foods_by_ids(array['cb000000-0000-0000-0000-000000000002'::uuid])), 360::numeric,
  'foods_by_ids returns the per-100 g values');

select pg_temp.anonymous();
select throws_ok($$ select * from public.foods_by_dishfinder_ids(array[9001]) $$, '42501', null, 'anon cannot look foods up');
select throws_ok($$ select * from public.recipes $$, '42501', null, 'anon reads no recipe');

select * from finish();
rollback;
