-- HealthApp schema · engine tables read-only at the privilege layer, anon on no table
--
-- 20260826075027_table_grants.sql granted the engine-owned tables SELECT only
-- and said anon gets nothing. Both held only on paper: Supabase's default
-- privileges give every table `postgres` creates in `public` ALL to anon,
-- authenticated and service_role, and that migration only ever added grants,
-- never revoked the ambient ones. On a real stack (CI, and the hosted project)
-- a signed-in user therefore held UPDATE and DELETE on user_badges and badges,
-- and anon held SELECT on notifications. Caught by advanced_achievements tests
-- 31-33 and social_notifications test 43, which expect 42501 and got none.
--
-- No data was exposed: RLS is on for every one of these tables and no policy
-- grants anon anything or a user a write here, so those statements matched zero
-- rows. This makes them refusals again, so the grants say what the policies
-- mean (and TRUNCATE, which RLS does not filter, is not held by any API role).
--
-- Every in-database write to these tables is a security-definer function; the
-- edge functions write them as service_role. The one user write the app makes,
-- notifications.read_at, keeps its column grant (20261008100000).

-- ---------- engine-owned tables: select, nothing else ----------
revoke all on table
  public.account_deletion_requests,
  public.adherence_snapshots,
  public.badges,
  public.streaks,
  public.subscriptions,
  public.user_badges
from anon, authenticated;
grant select on table
  public.account_deletion_requests,
  public.adherence_snapshots,
  public.badges,
  public.streaks,
  public.subscriptions,
  public.user_badges
to authenticated;

-- ---------- notifications: select + update (read_at) ----------
-- Revoking UPDATE at table level would also drop the read_at column grant,
-- so only the rest goes.
revoke insert, delete, truncate, references, trigger on table public.notifications from authenticated;

-- ---------- anon: no table at all ----------
-- Every policy in the schema is `to authenticated` (or service_role), so anon
-- already read zero rows everywhere; anonymous reads go through the Coach
-- Discovery security-definer functions. Now the privilege says so too, and
-- tables created from here on start without an anon grant.
revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
