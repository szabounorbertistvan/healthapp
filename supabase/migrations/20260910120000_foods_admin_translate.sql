-- Admins may edit the shared food library.
--
-- The USDA import (supabase/seed/usda-foods.sql) lands several thousand generic
-- foods with English names only. Someone has to type the Romanian ones, and
-- that someone is an admin working in /admin/foods. Until now the only write
-- policy on `foods` was for a row's own custom-food owner, so system rows
-- (source 'usda' / 'off') were read-only for everyone but the service role.
--
-- Scope: update only. Admins do not insert system rows (imports do) and do not
-- delete them (food_logs.food_id points at them; the FK is `on delete set null`,
-- but a vanished food is still a worse day than a mistranslated one).

create policy foods_admin_update on public.foods for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
