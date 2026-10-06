-- HealthApp schema · table privileges match the intent of migration 13
--
-- 20260826075027_table_grants.sql grants each table exactly the commands it has
-- a policy for, and says engine-owned tables are read-only "at the privilege
-- layer too". On a real Supabase project that was never true: `postgres` DOES
-- carry a default ACL in `public` there, granting every new table ALL (insert,
-- update, delete, truncate, references, trigger) to anon AND authenticated.
-- Verified live 2026-10-05: authenticated held full DML on badges and
-- user_badges, and anon could select from notifications. The offline harness
-- (scripts/pgtest) has no such default, which is why the pgTAP suites
-- advanced_achievements (#31-33) and social_notifications (#43) passed locally
-- and failed in CI.
--
-- RLS still filtered every row (no write policy, no anon policy), so nothing
-- leaked through PostgREST. But a write that should be refused answered
-- "success, zero rows", and TRUNCATE ignores RLS entirely. This closes the
-- privilege layer so the two layers agree again.
--
-- anon reaches data only through security-definer RPCs (coach_public_*,
-- search_coaches, coach_discovery_facets, username_available,
-- record_login_failure, record_app_error), which need no table privileges.

-- ---------- anon: no table privileges at all ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ---------- authenticated: never truncate / trigger / references ----------
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- ---------- engine-owned tables: read-only for users ----------
-- Written by the service role and by security-definer triggers only.
revoke insert, update, delete on table
  public.account_deletion_requests,
  public.adherence_snapshots,
  public.badges,
  public.streaks,
  public.subscriptions,
  public.user_badges
from authenticated;

-- notifications: select, plus update of read_at only (20261008100000).
revoke insert, delete on table public.notifications from authenticated;
