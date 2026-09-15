-- Admins may edit the shared exercise library.
--
-- The Free Exercise DB import (supabase/functions/import-exercises) lands 873
-- public-domain exercises with English names and English instructions. Someone
-- has to write the Romanian ones, and that someone is an admin working in
-- /admin/exercises — the same desk /admin/foods already gives the food library.
-- Until now the only write policy on `exercises` was for a row's own owner
-- (custom exercises), so library rows (owner_id null) were read-only for
-- everyone but the service role.
--
-- Scope: update only, and the same shape as foods_admin_update. Admins do not
-- insert library rows (the import does) and do not delete them:
-- program_exercises.exercise_id and logged_sets.exercise_id point at them.

create policy exercises_admin_update on public.exercises for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
