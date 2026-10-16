-- My recipes: a recipe handed over from DishFinder, adjusted and kept in Voinic (2026-12-01)
--
-- relu's decision (2026-10-16): nothing is imported from DishFinder ahead of
-- time. A recipe enters Voinic only when a person presses "Add to Voinic" on
-- it in DishFinder; DishFinder's server signs the recipe's data and posts it
-- here (apps/web/app/recipes/receive), the person adjusts it in a dialog and
-- saves it as their own. Voinic never calls DishFinder — the data travels with
-- the person's click, and the signature is what makes it trustworthy.
--
--   recipes             one per saved recipe, owner-only. Nutrition is per
--                       SERVING, with the serving's weight, because food_logs
--                       counts grams: logging n servings writes
--                       n × serving_grams g and n × the per-serving macros.
--                       nutrition_source says where the numbers come from:
--                       'dishfinder' (as handed over, scaled to the serving
--                       count) or 'voinic' (recomputed from the matched foods
--                       after the person changed ingredients).
--   recipe_ingredients  the recipe's lines as DishFinder wrote them (label),
--                       the Voinic food each one was matched to and its grams,
--                       when known — for showing the recipe and recomputing.
--
-- Not a source of truth for anyone else: no coach read, no public read. A
-- person may write any number into their own recipe (as with their custom
-- foods); what the dialog shows as "from DishFinder" is checked server-side
-- against the signed hand-off before it is saved.
--
-- Caps: 300 recipes a person, 60 lines a recipe.
--
-- Also: food_log_method gains 'recipe', so a diary entry says it came from one.

alter type food_log_method add value if not exists 'recipe';

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  servings numeric(6,2) not null check (servings > 0 and servings <= 500),
  serving_grams numeric(7,1) not null check (serving_grams > 0 and serving_grams <= 3000),
  kcal_serving numeric(7,1) not null check (kcal_serving >= 0 and kcal_serving <= 10000),
  protein_serving numeric(6,1) not null default 0 check (protein_serving >= 0 and protein_serving <= 1000),
  carbs_serving numeric(6,1) not null default 0 check (carbs_serving >= 0 and carbs_serving <= 2000),
  fat_serving numeric(6,1) not null default 0 check (fat_serving >= 0 and fat_serving <= 1000),
  nutrition_source text not null check (nutrition_source in ('dishfinder', 'voinic')),
  dishfinder_recipe_id int check (dishfinder_recipe_id is null or dishfinder_recipe_id > 0),
  dishfinder_url text check (dishfinder_url is null or (dishfinder_url ~ '^https://' and length(dishfinder_url) <= 500)),
  image_url text check (image_url is null or (image_url ~ '^https://' and length(image_url) <= 500)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_owner_idx on public.recipes (owner_id, updated_at desc);
create index recipes_owner_dishfinder_idx on public.recipes (owner_id, dishfinder_recipe_id) where dishfinder_recipe_id is not null;
create trigger recipes_updated before update on public.recipes
  for each row execute function public.handle_updated_at();

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  position int not null check (position >= 0 and position < 60),
  label text not null check (length(btrim(label)) between 1 and 200),
  food_id uuid references public.foods (id) on delete set null,
  grams numeric(7,1) check (grams is null or (grams > 0 and grams <= 20000)),
  dishfinder_ingredient_id int check (dishfinder_ingredient_id is null or dishfinder_ingredient_id > 0),
  unique (recipe_id, position)
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, position);

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;

create policy recipes_owner on public.recipes for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy recipe_ingredients_owner on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.owner_id = auth.uid()));

revoke all on public.recipes, public.recipe_ingredients from anon;
revoke all on public.recipes, public.recipe_ingredients from authenticated;
grant select, insert, update, delete on public.recipes, public.recipe_ingredients to authenticated;

-- ---------- caps ----------
create or replace function public.recipes_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'recipes' then
    if (select count(*) from public.recipes where owner_id = new.owner_id) >= 300 then
      raise exception 'RECIPE_LIMIT' using errcode = '23514';
    end if;
  elsif (select count(*) from public.recipe_ingredients where recipe_id = new.recipe_id) >= 60 then
    raise exception 'RECIPE_LINES_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.recipes_cap() from public, anon, authenticated;
create trigger recipes_cap before insert on public.recipes
  for each row execute function public.recipes_cap();
create trigger recipe_ingredients_cap before insert on public.recipe_ingredients
  for each row execute function public.recipes_cap();

-- ---------- the foods a recipe's lines can be matched to ----------
-- foods is not listable (20261019120000); these two read only what a recipe
-- needs, with food_by_id()'s visibility (no one else's custom foods).

-- Foods carrying any of these DishFinder ingredient ids: the dialog's first guess per line.
create or replace function public.foods_by_dishfinder_ids(p_ids int[])
returns table (
  id uuid, dishfinder_ingredient_id int, source food_source, name_en text, name_ro text,
  kcal_100g numeric, protein_100g numeric, carbs_100g numeric, fat_100g numeric
)
language sql stable security definer set search_path = public as $$
  select f.id, f.dishfinder_ingredient_id, f.source, f.name_en, f.name_ro,
         f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g
    from public.foods f
   where auth.uid() is not null
     and coalesce(cardinality(p_ids), 0) between 1 and 60
     and f.dishfinder_ingredient_id = any (p_ids)
     and (f.source <> 'custom' or f.owner_id = auth.uid())
   order by f.dishfinder_ingredient_id, (f.name_ro is null), f.verified desc, length(coalesce(f.name_ro, f.name_en))
   limit 300;
$$;
revoke execute on function public.foods_by_dishfinder_ids(int[]) from public, anon;
grant execute on function public.foods_by_dishfinder_ids(int[]) to authenticated;

-- The per-100 g values of chosen foods, for recomputing a recipe on the server.
create or replace function public.foods_by_ids(p_ids uuid[])
returns table (
  id uuid, name_en text, name_ro text,
  kcal_100g numeric, protein_100g numeric, carbs_100g numeric, fat_100g numeric
)
language sql stable security definer set search_path = public as $$
  select f.id, f.name_en, f.name_ro, f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g
    from public.foods f
   where auth.uid() is not null
     and coalesce(cardinality(p_ids), 0) between 1 and 60
     and f.id = any (p_ids)
     and (f.source <> 'custom' or f.owner_id = auth.uid());
$$;
revoke execute on function public.foods_by_ids(uuid[]) from public, anon;
grant execute on function public.foods_by_ids(uuid[]) to authenticated;
