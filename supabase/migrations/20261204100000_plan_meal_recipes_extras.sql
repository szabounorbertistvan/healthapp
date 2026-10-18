-- Planned meals: a linked recipe, and extra meals on one day (2026-12-04)
--
-- Two columns on planned_meals, nothing beside it.
--
--   recipe_id  an existing recipe (20261201100000) the meal is cooked from.
--              A REFERENCE, not ingredients: the meal's foods and grams stay
--              what the day is costed from, so linking a recipe never adds a
--              calorie. Only the plan's editor links, and only a recipe of
--              their own (planned_meals_guard). Deleting the recipe unlinks it
--              (on delete set null); the meal and its foods stay.
--   extra      a meal beyond the base slots, written for ONE weekday
--              (day_index 1..7). mealsForWeekday (packages/shared/meal-days)
--              adds extras to the day instead of letting them replace the slot
--              meal; `slot` only says which diary meal it is logged into. At
--              most 4 extras a day per plan (planned_meals_guard).
--
-- Reading a linked recipe: recipes and recipe_ingredients were owner-only.
-- The client of a PUBLISHED plan now also reads the recipes that plan links,
-- read-only (recipes_plan_client_read) — the plan is what was shared with
-- them, and these are the recipes it names. Nothing else about a recipe
-- becomes visible to anyone.

alter table public.planned_meals
  add column recipe_id uuid references public.recipes (id) on delete set null,
  add column extra boolean not null default false;

alter table public.planned_meals
  add constraint planned_meals_extra_day check (not extra or day_index between 1 and 7),
  -- new and renamed meals; the rows already there are not re-checked
  add constraint planned_meals_name_length check (length(btrim(name)) between 1 and 60) not valid;

create index planned_meals_recipe_idx on public.planned_meals (recipe_id) where recipe_id is not null;

-- ---------- guard: own recipes only, a cap on extras ----------
create or replace function public.planned_meals_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.recipe_id is not null
     and (tg_op = 'INSERT' or new.recipe_id is distinct from old.recipe_id)
     and auth.uid() is not null
     and not exists (select 1 from public.recipes r where r.id = new.recipe_id and r.owner_id = auth.uid()) then
    raise exception 'RECIPE_NOT_YOURS' using errcode = '42501';
  end if;

  if new.extra
     and (tg_op = 'INSERT' or not old.extra or new.day_index <> old.day_index or new.plan_id <> old.plan_id)
     and (select count(*) from public.planned_meals m
           where m.plan_id = new.plan_id and m.day_index = new.day_index and m.extra and m.id <> new.id) >= 4 then
    raise exception 'EXTRA_MEAL_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.planned_meals_guard() from public, anon, authenticated;
create trigger planned_meals_guard before insert or update on public.planned_meals
  for each row execute function public.planned_meals_guard();

-- ---------- the plan's client reads the recipes the plan links ----------
create policy recipes_plan_client_read on public.recipes for select to authenticated
  using (exists (
    select 1 from public.planned_meals m join public.nutrition_plans n on n.id = m.plan_id
     where m.recipe_id = recipes.id and n.client_id = auth.uid() and n.status = 'published'));
create policy recipe_ingredients_plan_client_read on public.recipe_ingredients for select to authenticated
  using (exists (
    select 1 from public.planned_meals m join public.nutrition_plans n on n.id = m.plan_id
     where m.recipe_id = recipe_ingredients.recipe_id and n.client_id = auth.uid() and n.status = 'published'));

comment on column public.planned_meals.recipe_id is
  'The recipe this meal is cooked from — a reference only; the meal is costed from its foods.';
comment on column public.planned_meals.extra is
  'A meal added to one weekday (day_index 1..7) on top of the base slots; at most 4 a day.';
