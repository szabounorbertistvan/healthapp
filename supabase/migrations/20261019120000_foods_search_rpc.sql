-- The shared food library stops being bulk-readable.
--
-- Until now `foods_select` was `using (true)`: any signed-in account could pull
-- the whole table in one PostgREST call — 6781 USDA rows, the Romanian names
-- that came from DishFinder (seed/dishfinder-names.sql), and, as a side effect,
-- every other user's custom foods. The names are hand-written work relu does not
-- want copyable, and the customs were never meant to be shared.
--
-- New shape, same idea as the rest of the RLS layer: you read a food row when it
-- is already yours in some sense, and you *find* foods through a function that
-- answers one search at a time.
--
--   * foods_select: own customs, admins, and any food referenced by a plan you
--     are the client or coach of, by your own food log or by your favourites.
--     Embedded selects (planned_meal_foods → foods, food_logs → foods) keep
--     working because those rows are, by definition, referenced.
--   * search_foods(q): security definer, ≥ 2 characters, ≤ 60 rows, other
--     people's customs excluded, and a per-user cap of 400 searches a day kept
--     in food_search_quota. 400 is far above a coach building plans all
--     afternoon (a search per debounced keystroke, ~150 on a heavy day) and far
--     below what enumerating the list by prefixes needs.
--   * food_by_id / food_by_barcode: the two single-row reads the pickers need
--     before a food is referenced anywhere — adding it to a plan, logging it,
--     scanning it.
--
-- What this does not do: stop a patient human from copying what the screen
-- shows them. It stops the one-call dump and makes the slow way slow.

-- ---------- quota ----------
create table if not exists public.food_search_quota (
  user_id uuid not null references public.users (id) on delete cascade,
  day     date not null default current_date,
  hits    int  not null default 0,
  primary key (user_id, day)
);
alter table public.food_search_quota enable row level security;
-- No policies on purpose: only the definer function below touches it.
comment on table public.food_search_quota is
  'search_foods() calls per user per day; written only by that function';

-- ---------- visibility ----------
create or replace function public.food_visible(p_food uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
       p_owner = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.food_logs l
                where l.food_id = p_food and l.user_id = auth.uid())
    or exists (select 1 from public.food_favorites v
                where v.food_id = p_food and v.user_id = auth.uid())
    or exists (select 1 from public.planned_meal_foods pmf
                 join public.planned_meals pm on pm.id = pmf.planned_meal_id
                 join public.nutrition_plans np on np.id = pm.plan_id
                where pmf.food_id = p_food
                  and (np.client_id = auth.uid() or np.coach_id = auth.uid()))
  );
$$;
revoke execute on function public.food_visible(uuid, uuid) from public, anon;
grant execute on function public.food_visible(uuid, uuid) to authenticated;

drop policy if exists foods_select on public.foods;
create policy foods_select on public.foods for select to authenticated
  using (public.food_visible(id, owner_id));

-- planned_meal_foods.food_id and food_favorites.food_id had no index of their
-- own; the visibility check looks them up per food row.
create index if not exists planned_meal_foods_food_idx on public.planned_meal_foods (food_id);
create index if not exists food_favorites_food_idx on public.food_favorites (food_id);
create index if not exists food_logs_food_idx on public.food_logs (food_id);

-- ---------- search ----------
create or replace function public.search_foods(p_q text, p_limit int default 60)
returns table (
  id uuid, source food_source, name_en text, name_ro text, brand text,
  kcal_100g numeric, protein_100g numeric, carbs_100g numeric, fat_100g numeric,
  portions jsonb, verified boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  -- search_text is the lower-cased, unaccented name+brand kept by the table;
  -- the term gets the same treatment, minus LIKE/filter metacharacters.
  v_q    text := btrim(public.search_normalize(regexp_replace(coalesce(p_q, ''), '[,()%\\_]', ' ', 'g')));
  v_hits int;
begin
  if v_user is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return;
  end if;

  insert into public.food_search_quota as q (user_id, day, hits)
  values (v_user, current_date, 1)
  on conflict (user_id, day) do update set hits = q.hits + 1
  returning q.hits into v_hits;
  if v_hits > 400 then
    raise exception 'FOOD_SEARCH_RATE' using errcode = 'P0001';
  end if;

  return query
    select f.id, f.source, f.name_en, f.name_ro, f.brand,
           f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g,
           f.portions, f.verified
      from public.foods f
     where f.search_text like '%' || v_q || '%'
       and (f.source <> 'custom' or f.owner_id = v_user)
     -- Romanian-named rows first, then the verified, then by name: the
     -- pickers fold what is left of the English USDA tail.
     order by (f.name_ro is null), f.name_ro, f.verified desc, f.name_en
     limit least(greatest(coalesce(p_limit, 60), 1), 60);
end;
$$;
revoke execute on function public.search_foods(text, int) from public, anon;
grant execute on function public.search_foods(text, int) to authenticated;

-- ---------- single-row reads ----------
create or replace function public.food_by_id(p_id uuid)
returns table (
  id uuid, source food_source, name_en text, name_ro text, brand text,
  kcal_100g numeric, protein_100g numeric, carbs_100g numeric, fat_100g numeric,
  portions jsonb, verified boolean
)
language sql stable security definer set search_path = public as $$
  select f.id, f.source, f.name_en, f.name_ro, f.brand,
         f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g, f.portions, f.verified
    from public.foods f
   where auth.uid() is not null
     and f.id = p_id
     and (f.source <> 'custom' or f.owner_id = auth.uid());
$$;
revoke execute on function public.food_by_id(uuid) from public, anon;
grant execute on function public.food_by_id(uuid) to authenticated;

create or replace function public.food_by_barcode(p_code text)
returns table (
  id uuid, source food_source, name_en text, name_ro text, brand text,
  kcal_100g numeric, protein_100g numeric, carbs_100g numeric, fat_100g numeric,
  portions jsonb, verified boolean
)
language sql stable security definer set search_path = public as $$
  select f.id, f.source, f.name_en, f.name_ro, f.brand,
         f.kcal_100g, f.protein_100g, f.carbs_100g, f.fat_100g, f.portions, f.verified
    from public.foods f
   where auth.uid() is not null
     and f.barcode = p_code
     and p_code ~ '^\d{6,14}$'
     and (f.source <> 'custom' or f.owner_id = auth.uid())
   limit 1;
$$;
revoke execute on function public.food_by_barcode(text) from public, anon;
grant execute on function public.food_by_barcode(text) to authenticated;
