-- pgTAP · planned meals: a linked recipe and extra meals on one day
-- (20261204100000_plan_meal_recipes_extras).
--
-- Cast:
--   c1  coach of m1          c2  another coach, with a recipe of their own
--   m1  c1's client (published plan p1, draft plan p2)
--   m2  a client nobody here coaches
--
-- Run with a local stack up:  npm run db:test

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create or replace function pg_temp.authenticate_as(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$fn$;

-- ---------- fixtures (as the database owner: no RLS, no auth.uid()) ----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d7000000-0000-0000-0000-000000000001', 'pr-coach@test.local',  '{}'),
  ('d7000000-0000-0000-0000-000000000002', 'pr-coach2@test.local', '{}'),
  ('d7000000-0000-0000-0000-000000000011', 'pr-m1@test.local',     '{}'),
  ('d7000000-0000-0000-0000-000000000012', 'pr-m2@test.local',     '{}');
update public.users set role = 'coach'
 where id in ('d7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000002');
insert into public.trainer_clients (coach_id, client_id, status, started_at) values
  ('d7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000011', 'active', now());

insert into public.recipes (id, owner_id, title, servings, serving_grams, kcal_serving, nutrition_source, steps) values
  ('d7000000-0000-0000-0000-0000000000a1', 'd7000000-0000-0000-0000-000000000001', 'Sarmale', 40, 80, 123, 'voinic', array['Roll.', 'Simmer.']),
  ('d7000000-0000-0000-0000-0000000000a2', 'd7000000-0000-0000-0000-000000000002', 'Not yours', 1, 100, 100, 'voinic', '{}'),
  ('d7000000-0000-0000-0000-0000000000a3', 'd7000000-0000-0000-0000-000000000001', 'Draft only', 1, 100, 100, 'voinic', '{}');
insert into public.recipe_ingredients (recipe_id, position, label, grams) values
  ('d7000000-0000-0000-0000-0000000000a1', 0, '1,5 kg varză murată', 1500);

insert into public.nutrition_plans (id, coach_id, client_id, name, status, kcal_target) values
  ('d7000000-0000-0000-0000-0000000000b1', 'd7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000011', 'Cut', 'published', 2000),
  ('d7000000-0000-0000-0000-0000000000b2', 'd7000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000011', 'Next', 'draft', 1800);
insert into public.planned_meals (id, plan_id, slot, name, position) values
  ('d7000000-0000-0000-0000-0000000000c1', 'd7000000-0000-0000-0000-0000000000b1', 'lunch', 'Lunch', 1),
  ('d7000000-0000-0000-0000-0000000000c2', 'd7000000-0000-0000-0000-0000000000b2', 'dinner', 'Dinner', 2);

-- ---------- linking a recipe ----------
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000001');
select lives_ok($$ update public.planned_meals set recipe_id = 'd7000000-0000-0000-0000-0000000000a1'
                    where id = 'd7000000-0000-0000-0000-0000000000c1' $$,
  'the plan''s coach links a recipe of their own');
select throws_ok($$ update public.planned_meals set recipe_id = 'd7000000-0000-0000-0000-0000000000a2'
                     where id = 'd7000000-0000-0000-0000-0000000000c1' $$,
  '42501', null, '...never someone else''s recipe');
select lives_ok($$ update public.planned_meals set recipe_id = 'd7000000-0000-0000-0000-0000000000a3'
                    where id = 'd7000000-0000-0000-0000-0000000000c2' $$,
  'a draft plan can link one too');

-- ---------- reading it ----------
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000011');
select is((select array_agg(title order by title) from public.recipes), array['Sarmale'],
  'the client reads the recipe their published plan links — not the draft''s, not the coach''s others');
select is((select count(*)::int from public.recipe_ingredients), 1, '...and its lines');
select is((select steps[2] from public.recipes), 'Simmer.', '...and its steps');
update public.recipes set title = 'Mine now';
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000001');
select is((select title from public.recipes where id = 'd7000000-0000-0000-0000-0000000000a1'), 'Sarmale',
  'reading is all the client may do');
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000012');
select is((select count(*)::int from public.recipes), 0, 'anyone else reads no recipe');

-- ---------- extra meals ----------
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000001');
select lives_ok($$
  insert into public.planned_meals (plan_id, slot, name, day_index, extra, position) values
    ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Pre-workout', 2, true, 100),
    ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Second', 2, true, 101),
    ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Third', 2, true, 102),
    ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Fourth', 2, true, 103)
$$, 'four extra meals on a Tuesday');
select throws_ok($$
  insert into public.planned_meals (plan_id, slot, name, day_index, extra, position)
  values ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Fifth', 2, true, 104)
$$, '23514', null, '...not a fifth');
select lives_ok($$
  insert into public.planned_meals (plan_id, slot, name, day_index, extra, position)
  values ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Wednesday snack', 3, true, 100)
$$, 'the cap is per day');
select throws_ok($$
  update public.planned_meals set day_index = 2 where name = 'Wednesday snack'
$$, '23514', null, 'moving an extra onto a full day is refused too');
select throws_ok($$
  insert into public.planned_meals (plan_id, slot, name, day_index, extra)
  values ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Every day extra', 0, true)
$$, '23514', null, 'an extra belongs to one weekday, not the base menu');
select throws_ok($$
  insert into public.planned_meals (plan_id, slot, name, day_index, extra)
  values ('d7000000-0000-0000-0000-0000000000b1', 'snack', '   ', 4, true)
$$, '23514', null, 'a meal has a name');
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000002');
select throws_ok($$
  insert into public.planned_meals (plan_id, slot, name, day_index, extra)
  values ('d7000000-0000-0000-0000-0000000000b1', 'snack', 'Intruder', 5, true)
$$, '42501', null, 'another coach adds no meal to the plan');

-- ---------- a person's own plan (/food/plan) ----------
-- m2 has no coach: their targets plan (coach_id null) is theirs to fill.
reset role;
insert into public.nutrition_plans (id, coach_id, client_id, name, status, kcal_target) values
  ('d7000000-0000-0000-0000-0000000000b3', null, 'd7000000-0000-0000-0000-000000000012', 'My targets', 'published', 2100);
insert into public.recipes (id, owner_id, title, servings, serving_grams, kcal_serving, nutrition_source) values
  ('d7000000-0000-0000-0000-0000000000a4', 'd7000000-0000-0000-0000-000000000012', 'My oats', 1, 300, 400, 'voinic');
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000012');
select lives_ok($$
  insert into public.planned_meals (plan_id, slot, name, position, recipe_id)
  values ('d7000000-0000-0000-0000-0000000000b3', 'breakfast', 'Breakfast', 0, 'd7000000-0000-0000-0000-0000000000a4')
$$, 'a solo person adds a meal to their own plan, linked to their own recipe');
select lives_ok($$
  insert into public.planned_meals (plan_id, slot, name, day_index, extra, position)
  values ('d7000000-0000-0000-0000-0000000000b3', 'snack', 'Pre-run', 6, true, 100)
$$, '...and an extra meal on one day');
select throws_ok($$
  insert into public.planned_meals (plan_id, slot, name, position)
  values ('d7000000-0000-0000-0000-0000000000b1', 'dinner', 'Not my plan', 2)
$$, '42501', null, '...but nothing to someone else''s plan');

-- ---------- a deleted recipe unlinks, the meal stays ----------
select pg_temp.authenticate_as('d7000000-0000-0000-0000-000000000001');
delete from public.recipes where id = 'd7000000-0000-0000-0000-0000000000a1';
select is((select recipe_id from public.planned_meals where id = 'd7000000-0000-0000-0000-0000000000c1'), null::uuid,
  'deleting the recipe unlinks it');
select is((select name from public.planned_meals where id = 'd7000000-0000-0000-0000-0000000000c1'), 'Lunch',
  '...and the meal is still there');

select * from finish();
rollback;
