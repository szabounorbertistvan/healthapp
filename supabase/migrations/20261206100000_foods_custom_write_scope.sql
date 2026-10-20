-- Custom foods stay custom (2026-12-06)
--
-- The food logger now creates custom foods from a search or a barcode miss
-- (NewFoodForm → createCustomFood). Looking at the policies that write them:
--
--   * foods_custom_insert asked for source = 'custom' and owner_id = you —
--     right — but not verified = false, so anyone could stamp their own row
--     "verified", which search_foods() ranks ahead of the rest;
--   * foods_custom_update asked only owner_id = you. An owner could flip their
--     row's source to 'off' or 'usda', and search_foods() / food_by_barcode()
--     hide only *custom* rows of other people: the row — name, brand, barcode,
--     typed by one person — would then show up in everyone's search and answer
--     everyone's scan of that code. The library is not listable
--     (20261019120000) precisely so that one person's text reaches nobody else.
--
-- Both now pin source = 'custom', owner_id = you and verified = false on the
-- written row. Admins keep their own update path (foods_admin_update); the
-- service role (edge functions, seeds) is not subject to RLS.
--
-- food_by_barcode() also had `limit 1` with no order: once a person saved a
-- custom food for a code and Open Food Facts later learned the same code, which
-- one a scan returned was up to the planner. Their own row now wins — they
-- typed it because the shared one was missing or wrong — then verified rows.
-- Same signature, same grants.

drop policy if exists foods_custom_insert on public.foods;
create policy foods_custom_insert on public.foods for insert to authenticated
  with check (source = 'custom' and owner_id = auth.uid() and verified = false);

drop policy if exists foods_custom_update on public.foods;
create policy foods_custom_update on public.foods for update to authenticated
  using (owner_id = auth.uid())
  with check (source = 'custom' and owner_id = auth.uid() and verified = false);

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
   order by (f.owner_id is not distinct from auth.uid()) desc, f.verified desc, f.created_at
   limit 1;
$$;
revoke execute on function public.food_by_barcode(text) from public, anon;
grant execute on function public.food_by_barcode(text) to authenticated;
