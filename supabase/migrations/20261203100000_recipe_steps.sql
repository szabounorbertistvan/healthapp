-- Recipe preparation: numbered steps and the two times (2026-12-03)
--
-- A saved recipe (20261201100000) carried its ingredients and nutrition but no
-- way to cook it. Three columns on `recipes`, nothing new beside it:
--
--   steps         the preparation, in order — one array element per numbered
--                 step. Empty means "no instructions": the app shows that, it
--                 never makes steps up. DishFinder's hand-off carries none, so
--                 an imported recipe starts empty; its owner writes them.
--   prep_minutes  hands-on preparation, when known. Null = not stated.
--   cook_minutes  time on the heat / in the oven, when known. Null = not stated.
--
-- Recipe-level on purpose: logging n servings snapshots grams and macros into
-- food_logs, and a re-import overwrites only the nutrition columns it sets, so
-- writing or editing steps never touches a quantity anyone ate or planned.
--
-- Same access as the rest of the row: recipes_owner (owner reads and writes,
-- nobody else). No new grant — `update` on recipes is already granted.

alter table public.recipes
  add column steps text[] not null default '{}',
  add column prep_minutes int,
  add column cook_minutes int;

-- 40 steps, each 1..1000 characters after trimming. A CHECK may not hold a
-- subquery, hence the immutable function (as is_valid_food_portions does).
create or replace function public.is_valid_recipe_steps(p_steps text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(cardinality(p_steps), 0) <= 40
     and not exists (
       select 1 from unnest(coalesce(p_steps, '{}')) as s
        where s is null or length(btrim(s)) not between 1 and 1000
     );
$$;

alter table public.recipes
  add constraint recipes_steps_shape check (public.is_valid_recipe_steps(steps)),
  add constraint recipes_prep_minutes_range check (prep_minutes is null or prep_minutes between 0 and 1440),
  add constraint recipes_cook_minutes_range check (cook_minutes is null or cook_minutes between 0 and 1440);

comment on column public.recipes.steps is
  'Preparation steps in order, one element per step; empty = no instructions (never invented).';
comment on column public.recipes.prep_minutes is 'Preparation time in minutes; null = not stated.';
comment on column public.recipes.cook_minutes is 'Cooking time in minutes; null = not stated.';
