-- Favourite foods: a client's own shortlist in the food logger.
--
-- The picker shows "Favorites" and "Recent" above the search box so a staple
-- is one tap from being logged again. Recent needs no table (it is the tail
-- of food_logs); favourites do. The row snapshots the per-100 g basis for the
-- same reason food_logs does: a favourite must still log if its foods row is
-- later merged or deleted, and a product that came straight from Open Food
-- Facts may not have a foods row at all yet (food_id null, keyed by name).

create table public.food_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  food_id uuid references public.foods (id) on delete set null,
  food_name text not null check (length(btrim(food_name)) > 0),
  kcal_100g numeric(7,2) not null check (kcal_100g >= 0),
  protein_100g numeric(6,2) not null default 0 check (protein_100g >= 0),
  carbs_100g numeric(6,2) not null default 0 check (carbs_100g >= 0),
  fat_100g numeric(6,2) not null default 0 check (fat_100g >= 0),
  created_at timestamptz not null default now()
);

comment on table public.food_favorites is
  'Per-user starred foods for the logger. Per-100 g macros are a snapshot; food_id is a convenience link.';

-- One star per food per person: by row when the food has one, by name otherwise.
create unique index food_favorites_user_food_idx
  on public.food_favorites (user_id, food_id) where food_id is not null;
create unique index food_favorites_user_name_idx
  on public.food_favorites (user_id, lower(food_name)) where food_id is null;
create index food_favorites_user_idx on public.food_favorites (user_id, created_at desc);

-- Owner only. A coach reads what the client ate (food_logs); what they have
-- starred is a personal shortcut, not health data the coach needs.
alter table public.food_favorites enable row level security;
create policy food_favorites_owner on public.food_favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
