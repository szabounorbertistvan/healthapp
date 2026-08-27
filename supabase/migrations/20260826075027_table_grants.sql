-- HealthApp schema · 13 table privileges
--
-- Fixes a schema-wide gap: migrations 01-12 enable RLS and define 73 policies,
-- but never GRANT table privileges. Those are two independent layers — a policy
-- filters rows, it does not confer the right to touch the table — so every
-- query from a signed-in user failed with:
--
--   ERROR: permission denied for table measurements
--
-- Caught by supabase/tests/rls_client_isolation.test.sql, which could not get
-- past its first select.
--
-- WHY the ambient defaults did not cover it: pg_default_acl grants tables in
-- `public` only for objects created BY supabase_admin. Migrations run as
-- `postgres`, and `postgres` has no default-ACL entry for `public` (it has one
-- for `storage`, which is why storage works). So nothing was granted. This is
-- identical on hosted projects — `db push` also connects as `postgres` — so
-- this was never a local-only problem.
--
-- The grants below are DERIVED FROM THE POLICIES rather than blanket-granted:
-- each table receives exactly the commands it has a policy for. A table whose
-- only policy is FOR SELECT gets SELECT and nothing else, so the six
-- engine-owned tables stay read-only for users at the privilege layer too, not
-- just the policy layer. Verify with:
--
--   select c.relname, p.polcmd from pg_policy p
--   join pg_class c on c.oid = p.polrelid order by 1;
--
-- anon is granted nothing: no table has an anon policy, and the landing page
-- touches no tables. Function privileges are already handled explicitly in
-- migrations 09 and 12 and are deliberately left alone.

-- ---------- authenticated: full DML (tables with a FOR ALL policy) ----------
grant select, insert, update, delete on table
  public.check_ins,
  public.exercise_videos,
  public.food_logs,
  public.goals,
  public.habit_logs,
  public.habits,
  public.logged_sessions,
  public.logged_sets,
  public.measurements,
  public.nutrition_plans,
  public.planned_meal_foods,
  public.planned_meals,
  public.program_days,
  public.program_exercises,
  public.programs,
  public.progress_photos,
  public.set_videos
to authenticated;

-- exercises and foods are shared libraries with insert/update/delete policies
-- scoped to owner-created rows (owner_id is null for system rows).
grant select, insert, update, delete on table
  public.exercises,
  public.foods
to authenticated;

-- ---------- authenticated: partial DML ----------
-- coach_feedback: select, insert, update (no delete policy — feedback is a record)
grant select, insert, update on table public.coach_feedback to authenticated;

-- messages: select, insert, update (update is how read_at gets stamped)
grant select, insert, update on table public.messages to authenticated;

-- trainer_clients: select, insert, update (relationships end via status, never delete)
grant select, insert, update on table public.trainer_clients to authenticated;

-- conversations / workout_events: select, insert only
grant select, insert on table public.conversations  to authenticated;
grant select, insert on table public.workout_events to authenticated;

-- users: select, update (rows are created by the auth trigger, never by clients)
grant select, update on table public.users to authenticated;

-- notifications: select, update (mark-as-read); rows are enqueued by the engine
grant select, update on table public.notifications to authenticated;

-- ---------- authenticated: read-only ----------
-- Engine- and service-role-owned tables. No write policies by design, so no
-- write privileges either.
grant select on table
  public.account_deletion_requests,
  public.adherence_snapshots,
  public.badges,
  public.streaks,
  public.subscriptions,
  public.user_badges
to authenticated;

-- workout_events.id is the one non-uuid key in the schema, so its sequence
-- needs to be usable by whoever inserts.
grant usage, select on sequence public.workout_events_id_seq to authenticated;

-- ---------- service_role ----------
-- Drives pg_cron (compute_adherence_snapshots, detect_streak_risk,
-- detect_checkin_due) and the edge functions (sync-ingest, push-dispatch,
-- import-exercises). It has BYPASSRLS but that does not imply table
-- privileges, so it needs these explicitly.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- stop this recurring ----------
-- Without this, the next migration that adds a table reintroduces the same bug
-- silently. Mirrors what Supabase configures for supabase_admin, minus anon.
--
-- Deliberately NOT extended to functions: migrations 09 and 12 grant execute
-- per function and revoke it on the cron-only ones. An automatic default grant
-- would make that explicit intent harder to read.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
