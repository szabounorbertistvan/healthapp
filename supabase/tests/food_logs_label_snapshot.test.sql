-- pgTAP · label nutrients snapshotted on food_logs (20261126100000):
--
--   1. an entry takes saturated fat, sugar and salt from its food at log time
--   2. editing the food afterwards changes nothing already logged
--   3. a value the food does not carry stays null (unknown, never 0); so does
--      an entry without a food
--   4. the browser cannot write them: an insert or update sending its own
--      values is overridden; a grams edit rescales the snapshot
--
-- Rows are compared as text (format, null = empty) — the offline stub has no results_eq.
--
-- Run with a local stack up:  npm run db:test   (or offline: npm run db:test:offline food_logs_label_snapshot)

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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
  ('d9000000-0000-0000-0000-000000000001', 'snap@food.local', '{"full_name":"Snap"}');

-- a custom food with all three values, and one with sugar only
insert into public.foods (id, source, owner_id, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g, saturated_fat_100g, sugar_100g, salt_100g) values
  ('d9000000-0000-0000-0000-0000000000f1', 'custom', 'd9000000-0000-0000-0000-000000000001', 'Granola', 450, 10, 60, 18, 4.00, 20.00, 0.50),
  ('d9000000-0000-0000-0000-0000000000f2', 'custom', 'd9000000-0000-0000-0000-000000000001', 'Juice',    45,  0, 11,  0, null, 10.00, null);

select pg_temp.authenticate_as('d9000000-0000-0000-0000-000000000001');

-- the browser sends its own label values; they must be replaced
insert into public.food_logs (user_id, date, slot, food_id, food_name, grams, kcal, protein_g, carbs_g, fat_g, client_generated_id, saturated_fat_g, sugar_g, salt_g) values
  ('d9000000-0000-0000-0000-000000000001', '2026-10-01', 'breakfast', 'd9000000-0000-0000-0000-0000000000f1', 'Granola', 50, 225, 5, 30, 9, 'd9000000-0000-0000-0000-0000000000a1', 999, 999, 999),
  ('d9000000-0000-0000-0000-000000000001', '2026-10-01', 'breakfast', 'd9000000-0000-0000-0000-0000000000f2', 'Juice',  200,  90, 0, 22, 0, 'd9000000-0000-0000-0000-0000000000a2', null, null, null),
  ('d9000000-0000-0000-0000-000000000001', '2026-10-01', 'snack',     null,                                   'Quick',  100, 100, 0,  0, 0, 'd9000000-0000-0000-0000-0000000000a3', 5, 5, 5);

-- 1. taken from the food at log time (50 g of granola)
select is(
  (select format('%s|%s|%s', saturated_fat_g, sugar_g, salt_g) from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a1'),
  '2.00|10.00|0.25',
  '1a. the snapshot is the food''s values scaled to the grams, whatever the browser sent');

-- 3. unknown stays unknown
select is(
  (select format('%s|%s|%s', saturated_fat_g, sugar_g, salt_g) from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a2'),
  '|20.00|',
  '3a. a value the food does not carry stays null, never 0');
select is(
  (select format('%s|%s|%s', saturated_fat_g, sugar_g, salt_g) from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a3'),
  '||',
  '3b. an entry without a food carries no label values, whatever was sent');

-- 2. the food changes; history does not
update public.foods set saturated_fat_100g = 8, sugar_100g = 40, salt_100g = 1 where id = 'd9000000-0000-0000-0000-0000000000f1';
select is(
  (select format('%s|%s|%s', saturated_fat_g, sugar_g, salt_g) from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a1'),
  '2.00|10.00|0.25',
  '2a. editing the food leaves the logged entry as it was');

-- 4. a direct write is ignored; a grams edit rescales
update public.food_logs set sugar_g = 0, salt_g = 0 where client_generated_id = 'd9000000-0000-0000-0000-0000000000a1';
select is(
  (select format('%s|%s', sugar_g, salt_g) from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a1'),
  '10.00|0.25',
  '4a. an update sending its own label values keeps the snapshot');

update public.food_logs set grams = 100 where client_generated_id = 'd9000000-0000-0000-0000-0000000000a1';
select is(
  (select format('%s|%s|%s', saturated_fat_g, sugar_g, salt_g) from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a1'),
  '4.00|20.00|0.50',
  '4b. a grams edit rescales the logged snapshot, not the food as it is now');

update public.food_logs set grams = 100 where client_generated_id = 'd9000000-0000-0000-0000-0000000000a2';
select is(
  (select sugar_g from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a2'),
  10.00::numeric,
  '4c. a grams edit halves a halved entry');
select is(
  (select saturated_fat_g from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a2'),
  null::numeric,
  '4d. an unknown value stays unknown through a grams edit');

-- switching the entry to another food takes that food's values now
update public.food_logs set food_id = 'd9000000-0000-0000-0000-0000000000f1', grams = 10 where client_generated_id = 'd9000000-0000-0000-0000-0000000000a3';
select is(
  (select format('%s|%s|%s', saturated_fat_g, sugar_g, salt_g) from public.food_logs where client_generated_id = 'd9000000-0000-0000-0000-0000000000a3'),
  '0.80|4.00|0.10',
  '4e. pointing an entry at another food snapshots that food');

-- the trigger function is not callable on its own
reset role;
select is(
  has_function_privilege('authenticated', 'public.food_logs_label_snapshot()', 'execute'),
  false,
  '4f. authenticated cannot call the snapshot function directly');
select is(
  has_function_privilege('anon', 'public.food_logs_label_snapshot()', 'execute'),
  false,
  '4g. anon cannot call the snapshot function directly');

select * from finish();
rollback;
