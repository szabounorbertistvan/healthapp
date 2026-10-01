-- Link a shared food to its DishFinder ingredient.
--
-- DishFinder (the sibling restaurant/recipe product, docs/DISHFINDER.md) keys
-- its ingredients to the same USDA FoodData Central ids our USDA rows carry in
-- `external_id`. Joining on that id gives two things this column records:
--   * the Romanian name a human already wrote there — imported into `name_ro`
--     by supabase/seed/dishfinder-names.sql, never over an admin's own text;
--   * the DishFinder ingredient id, which its finder pages accept in the URL
--     (`?ingredients=[{"id":…,"name":…}]`), so a planned meal can open
--     "recipes with these ingredients" / "find it at a restaurant" with the
--     right filters instead of a free-text guess (apps/web/lib/dishfinder.ts).
--
-- Nullable: OFF products and custom foods have no DishFinder counterpart.
-- An integer, not a FK — it points into another product's database.

alter table public.foods
  add column if not exists dishfinder_ingredient_id integer
    check (dishfinder_ingredient_id is null or dishfinder_ingredient_id > 0);

comment on column public.foods.dishfinder_ingredient_id is
  'ingredients.id in DishFinder (matched on the USDA fdc id); null = no counterpart';
