-- pgTAP · anon executes only the anonymous doors (20261205100000)
--
-- EXECUTE defaulted to PUBLIC, so anon could call every security-definer
-- function — triggers, internal helpers and signed-in RPCs. Now: anon can call
-- exactly the Coach Discovery doors, email_unsubscribe and the three sign-in /
-- error RPCs; signed-in users keep what they had; the 14 functions the advisor
-- flagged have a fixed search_path; my_plan is a security-invoker view that
-- still answers only about the caller.
--
-- Run with a local stack up:  npm run db:test
-- or without Docker:          node scripts/pgtest/run.mjs function_privilege_hygiene

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create temp table doors (name text primary key);
insert into doors values
  ('coach_public_profile'), ('coach_public_posts'), ('coach_public_programs'), ('coach_public_reviews'),
  ('search_coaches'), ('coach_discovery_facets'), ('coach_booking_services'), ('coach_booking_slots'),
  ('coach_slug_redirect'), ('coach_sitemap'), ('marketplace_track'), ('email_unsubscribe'),
  ('username_available'), ('record_login_failure'), ('record_app_error');

-- ---------- the whole catalog ----------
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select name from doors)),
  '{}'::text[],
  'anon can execute no security-definer function except the doors');

select is(
  (select coalesce(array_agg(d.name order by 1), '{}') from doors d
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = d.name)
      or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = d.name
                   and not has_function_privilege('anon', p.oid, 'execute'))),
  '{}'::text[],
  'every door exists and anon can execute every overload of it');

select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('public', p.oid, 'execute')),
  '{}'::text[],
  'PUBLIC holds EXECUTE on no security-definer function');

-- ---------- a sample, by name ----------
select ok(not has_function_privilege('anon', 'public.is_admin()', 'execute'), 'anon: no is_admin()');
select ok(not has_function_privilege('anon', 'public.is_active_coach_of(uuid)', 'execute'), 'anon: no is_active_coach_of()');
select ok(not has_function_privilege('anon', 'public.claim_signup_role(text)', 'execute'), 'anon: no claim_signup_role()');
select ok(not has_function_privilege('anon', 'public.accept_invite(text)', 'execute'), 'anon: no accept_invite()');
select ok(not has_function_privilege('anon', 'public.coach_dashboard()', 'execute'), 'anon: no coach_dashboard()');
select ok(not has_function_privilege('anon', 'public.request_data_export()', 'execute'), 'anon: no request_data_export()');
select ok(not has_function_privilege('anon', 'public.handle_new_user()', 'execute'), 'anon: no handle_new_user() (trigger)');

-- ---------- signed-in users keep what they had ----------
select ok(has_function_privilege('authenticated', 'public.is_admin()', 'execute'), 'authenticated: is_admin() (RLS policies call it)');
select ok(has_function_privilege('authenticated', 'public.claim_signup_role(text)', 'execute'), 'authenticated: claim_signup_role() (Google callback)');
select ok(has_function_privilege('authenticated', 'public.my_local_today()', 'execute'), 'authenticated: my_local_today()');
select ok(not has_function_privilege('authenticated', 'public.own_tier(uuid)', 'execute'),
  'authenticated: own_tier() stays closed (20261120110000)');

-- ---------- as anon, for real ----------
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.is_admin() $$, '42501', null, 'anon calling is_admin() is refused');
select lives_ok($$ select * from public.coach_discovery_facets() $$, 'anon still calls coach_discovery_facets()');
select throws_ok($$ select * from public.my_plan $$, '42501', null, 'anon cannot read my_plan');
reset role;

-- ---------- search_path ----------
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('plan_limit', 'gym_google_field_mask', 'admin_audit_events_immutable', 'admin_uuid_or_null',
                       'handle_updated_at', 'preserve_food_portions', 'training_load_score', 'effective_rpe',
                       'time_range', 'time_multirange', 'public_display_name', 'coach_slug_base',
                       'coach_certifications_reset_verification', 'coach_profiles_edit_lock')
     and not (coalesce(p.proconfig, '{}') @> array['search_path=public'])),
  '{}'::text[],
  'the 14 flagged functions have search_path = public');
select is(public.coach_slug_base('Ab'), 'coach-ab', 'coach_slug_base() still works with its fixed search_path');

-- ---------- my_plan: security invoker, same answer ----------
select ok((select coalesce(c.reloptions, '{}') @> array['security_invoker=true']
           from pg_class c where c.oid = 'public.my_plan'::regclass),
  'my_plan is a security-invoker view');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f2000000-0000-0000-0000-000000000001', 'one@fph.local', '{"full_name":"One","username":"fph_one"}'),
  ('f2000000-0000-0000-0000-000000000002', 'two@fph.local', '{"full_name":"Two","username":"fph_two"}');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.my_plan), 1, 'my_plan: one row for a signed-in user');
select is((select user_id from public.my_plan), 'f2000000-0000-0000-0000-000000000001'::uuid, '… their own');
reset role;

select * from finish();
rollback;
