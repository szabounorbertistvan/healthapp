-- HealthApp schema · function EXECUTE privileges match the anonymous-door model
--
-- 20261030100000_privilege_hygiene.sql took every TABLE privilege away from
-- anon, but functions were left alone. Postgres grants EXECUTE on a new
-- function to PUBLIC, and on a Supabase project `postgres` also carries a
-- default ACL granting it to anon explicitly. So the Security Advisor
-- (read 2026-10-19) listed 63 security-definer functions anon could call —
-- triggers, internal helpers and signed-in RPCs alike. Each of them checks
-- auth.uid() or is a trigger, so nothing is known to leak; this is defense in
-- depth, so the privilege layer says what CLAUDE.md says: anon reaches data
-- only through the Coach Discovery doors and the three sign-in / error RPCs.
--
-- What it does, for every security-definer function in `public` that is not
-- an extension's:
--   1. whoever of authenticated / service_role can execute it now (through
--      PUBLIC or an explicit grant) gets an explicit grant, so revoking PUBLIC
--      changes nothing for them — a function deliberately closed to signed-in
--      users (own_tier, effective_tier, …, 20261120110000) stays closed;
--   2. EXECUTE is revoked from PUBLIC and anon;
--   3. the anonymous doors get anon back, by name (every overload).
-- Trigger functions need no EXECUTE at fire time, and RLS policies that call
-- is_admin() / is_active_coach_of() / is_connected_to() run only for
-- authenticated (anon holds no table privilege), so neither is affected.
-- claim_signup_role() stays signed-in only: the Google callback calls it after
-- exchangeCodeForSession(), with the new session.
--
-- Also: 12 of the 14 functions the advisor reports with a mutable search_path get
-- `search_path = public` (all of them use built-ins only). The other two,
-- time_range / time_multirange, are the range type's own constructors: on a
-- real Supabase stack `postgres` does not own them ("must be owner of function
-- time_multirange", CI 2026-10-19), and a constructor resolves nothing by name,
-- so they are left as they are. And my_plan becomes
-- a security-invoker view — it reads through my_plan_row(), itself security
-- definer, keyed to auth.uid(), executable by authenticated.

-- ---------- 1–2. no EXECUTE for PUBLIC / anon on security-definer functions ----------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    if has_function_privilege('authenticated', f.sig, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if has_function_privilege('service_role', f.sig, 'execute') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end;
$$;

-- ---------- 3. the anonymous doors ----------
-- Coach Discovery (CLAUDE.md, convention 4), the unsubscribe link, and the
-- three RPCs a page without a session needs: sign-up's username check, the
-- failed-sign-in log and the error page's report.
do $$
declare
  v_name text;
  v_sig regprocedure;
  v_found int;
begin
  foreach v_name in array array[
    'coach_public_profile', 'coach_public_posts', 'coach_public_programs', 'coach_public_reviews',
    'search_coaches', 'coach_discovery_facets', 'coach_booking_services', 'coach_booking_slots',
    'coach_slug_redirect', 'coach_sitemap', 'marketplace_track', 'email_unsubscribe',
    'username_available', 'record_login_failure', 'record_app_error'
  ] loop
    v_found := 0;
    for v_sig in
      select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    loop
      execute format('grant execute on function %s to anon, authenticated', v_sig);
      v_found := v_found + 1;
    end loop;
    if v_found = 0 then
      raise exception 'anonymous door % does not exist', v_name;
    end if;
  end loop;
end;
$$;

-- ---------- future functions: no EXECUTE for PUBLIC / anon by default ----------
-- A new anonymous door must say `grant execute … to anon` itself. authenticated
-- and service_role keep the default they already have on Supabase; stating it
-- makes the offline harness (no default ACL) behave the same.
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;

-- ---------- mutable search_path ----------
do $$
declare
  v_sig regprocedure;
  v_found int := 0;
begin
  for v_sig in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('plan_limit', 'gym_google_field_mask', 'admin_audit_events_immutable', 'admin_uuid_or_null',
                        'handle_updated_at', 'preserve_food_portions', 'training_load_score', 'effective_rpe',
                        'public_display_name', 'coach_slug_base',
                        'coach_certifications_reset_verification', 'coach_profiles_edit_lock')
  loop
    execute format('alter function %s set search_path = public', v_sig);
    v_found := v_found + 1;
  end loop;
  -- 12 names (the advisor's 14 minus the time_range / time_multirange constructors, below)
  if v_found < 12 then
    raise exception 'search_path: expected at least 12 functions, found %', v_found;
  end if;
end;
$$;

-- ---------- my_plan: security invoker ----------
-- The view needs no definer rights of its own: my_plan_row() is the definer,
-- and it answers only about auth.uid().
alter view public.my_plan set (security_invoker = true);
grant execute on function public.my_plan_row() to authenticated, service_role;
