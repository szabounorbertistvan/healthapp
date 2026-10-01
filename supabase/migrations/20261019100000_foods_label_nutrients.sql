-- Label-style nutrients on the shared food library.
--
-- `foods` carried only the four macros a plan is built on. The USDA import
-- (scripts/build-usda-seed-sql.mjs) now also reads saturated fat, total sugars
-- and sodium from SR Legacy, so the same rows can feed anything that shows an
-- EU-style label — and DishFinder's `ingredient_nutrition`, which already has
-- these three columns and is filled from this seed.
--
-- Nullable on purpose: "not measured" is not "0 g", and Open Food Facts /
-- custom rows never set them. Salt is grams of NaCl (sodium mg × 2.5 / 1000),
-- never raw sodium, so baking soda will legitimately read ~68 g.
--
-- Nothing in the app reads these yet; food_logs keep snapshotting only the
-- four macros.

alter table public.foods
  add column if not exists saturated_fat_100g numeric(6,2) check (saturated_fat_100g is null or saturated_fat_100g >= 0),
  add column if not exists sugar_100g         numeric(6,2) check (sugar_100g is null or sugar_100g >= 0),
  add column if not exists salt_100g          numeric(6,2) check (salt_100g is null or salt_100g >= 0);

comment on column public.foods.saturated_fat_100g is 'g per 100 g; null = not measured by the source';
comment on column public.foods.sugar_100g         is 'total sugars, g per 100 g; null = not measured';
comment on column public.foods.salt_100g          is 'salt (NaCl) g per 100 g = sodium mg × 2.5 / 1000; null = not measured';
