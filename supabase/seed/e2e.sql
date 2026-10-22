-- Voinic · the local E2E suite's accounts and fixed state (e2e-local/).
--
-- LOCAL ONLY. Applied by scripts/pgtest/stack.mjs (or by CI after `supabase
-- start`) to a throwaway database. It refuses to run unless the session set
-- `voinic.e2e = on` first — so pasted into a real project's SQL editor it
-- changes nothing: it also installs a test-only fault trigger on planned_meals
-- that must never exist in production.
--
-- Every account is on .test (undeliverable), password 'Voinic-E2E-local-1'.
--
--   coach A  e2e-coach-a   published profile /coaches/e2e-coach-alpha, accepting clients
--   coach B  e2e-coach-b   profile left as a draft (/coaches/e2e-coach-beta must 404)
--   client A e2e-client-a  coached by A (active): program "E2E Alpha Program", plan "E2E Alpha Plan"
--   client B e2e-client-b  coached by B (active)
--   client C e2e-client-c  no coach: sends and cancels a coaching request
--   client D e2e-client-d  A's ex-client (ended): program "E2E Ended Program", plan "E2E Ended Plan"
--   client E e2e-client-e  B's client, coaching paused: program "E2E Paused Program", plan "E2E Paused Plan"
--   client F e2e-client-f  B's client (active): program "E2E Stale Program" — isolation.spec pauses and resumes it
--   reset    e2e-reset     the password-reset flow changes this one's password
--   new client e2e-new-client  signed up after onboarding existed: no onboarding row (onboarding.spec)
--   new coach  e2e-new-coach   the same, as a coach
--
-- The soak trio (e2e-local/soak/, `npm run e2e:soak`), which plays the app
-- against itself round after round and owns nothing the specs above touch:
--   soak coach  e2e-soak-coach   published profile /coaches/e2e-soak-coach, accepting clients
--   soak client e2e-soak-client  coached by the soak coach (active), a conversation, nothing else
--   soak solo   e2e-soak-solo    no coach; requests the soak coach and ends it again each round
--
-- Every other account is an "existing" one, as 20261123100000 makes the accounts
-- it finds: past the welcome cards (onboarding_state welcome = done), so its
-- specs land where they always did.
--
-- Specs that write create their own rows (names carry a per-run tag) and remove
-- them; nothing here is modified by a spec except e2e-reset's password and
-- client C's requests, each owned by exactly one spec.
begin;

do $guard$
begin
  if current_setting('voinic.e2e', true) is distinct from 'on' then
    raise exception 'supabase/seed/e2e.sql is for the local E2E stack only (set voinic.e2e = on)';
  end if;
end
$guard$;

set local search_path = public, extensions;

create or replace function pg_temp.e2e_account(p_email text, p_name text, p_username text, p_role text)
returns uuid language plpgsql as $fn$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    p_email, crypt('Voinic-E2E-local-1', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_name, 'username', p_username, 'sex', 'other', 'birth_year', '1990',
                       'consent_version', '2026-10-08'),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
  update public.users set role = p_role::public.user_role, full_name = p_name, timezone = 'Europe/Bucharest' where id = v_id;
  return v_id;
end;
$fn$;

do $seed$
declare
  coach_a uuid := pg_temp.e2e_account('e2e-coach-a@voinic.test', 'Coach Alpha E2E', 'e2e_coach_a', 'coach');
  coach_b uuid := pg_temp.e2e_account('e2e-coach-b@voinic.test', 'Coach Beta E2E', 'e2e_coach_b', 'coach');
  client_a uuid := pg_temp.e2e_account('e2e-client-a@voinic.test', 'Client Ana E2E', 'e2e_client_a', 'client');
  client_b uuid := pg_temp.e2e_account('e2e-client-b@voinic.test', 'Client Bogdan E2E', 'e2e_client_b', 'client');
  client_c uuid := pg_temp.e2e_account('e2e-client-c@voinic.test', 'Client Cezar E2E', 'e2e_client_c', 'client');
  client_d uuid := pg_temp.e2e_account('e2e-client-d@voinic.test', 'Client Dana E2E', 'e2e_client_d', 'client');
  client_e uuid := pg_temp.e2e_account('e2e-client-e@voinic.test', 'Client Ema E2E', 'e2e_client_e', 'client');
  client_f uuid := pg_temp.e2e_account('e2e-client-f@voinic.test', 'Client Filip E2E', 'e2e_client_f', 'client');
  reset_u uuid := pg_temp.e2e_account('e2e-reset@voinic.test', 'Reset E2E', 'e2e_reset', 'client');
  new_client uuid := pg_temp.e2e_account('e2e-new-client@voinic.test', 'New Client E2E', 'e2e_new_client', 'client');
  new_coach uuid := pg_temp.e2e_account('e2e-new-coach@voinic.test', 'New Coach E2E', 'e2e_new_coach', 'coach');
  soak_coach uuid := pg_temp.e2e_account('e2e-soak-coach@voinic.test', 'Soak Coach E2E', 'e2e_soak_coach', 'coach');
  soak_client uuid := pg_temp.e2e_account('e2e-soak-client@voinic.test', 'Soak Client E2E', 'e2e_soak_client', 'client');
  soak_solo uuid := pg_temp.e2e_account('e2e-soak-solo@voinic.test', 'Soak Solo E2E', 'e2e_soak_solo', 'client');
  v_profile uuid;
  v_program uuid;
  v_day uuid;
  v_plan uuid;
  v_ex uuid := (select id from public.exercises where owner_id is null order by name_en limit 1);
begin
  -- relationships: A–client A and B–client B active; A–client D active, ended below
  insert into public.trainer_clients (coach_id, client_id, status, started_at) values
    (coach_a, client_a, 'active', now() - interval '30 days'),
    (coach_b, client_b, 'active', now() - interval '30 days'),
    (coach_a, client_d, 'active', now() - interval '60 days');
  insert into public.conversations (coach_id, client_id) values (coach_a, client_a), (coach_b, client_b), (coach_a, client_d)
    on conflict do nothing;

  -- coach A's published profile, made the way the app makes it (become_coach), published as an approval would
  perform set_config('request.jwt.claims', json_build_object('sub', coach_a::text, 'role', 'authenticated')::text, true);
  perform public.become_coach();
  perform set_config('request.jwt.claims', json_build_object('sub', coach_b::text, 'role', 'authenticated')::text, true);
  perform public.become_coach();
  perform set_config('request.jwt.claims', '', true);
  select id into v_profile from public.coach_profiles where user_id = coach_a;
  update public.coach_profiles set slug = 'e2e-coach-alpha',
    headline = 'E2E strength coach for the local test suite',
    about = 'A seeded coach for the local end-to-end suite. Not a real person; this database is thrown away after every run.',
    coaching_since = 2015, online = true, in_person = false, accepting_clients = true
  where id = v_profile;
  insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
  select v_profile, s.id, true from public.specializations s where s.slug = 'strength';
  insert into public.coach_languages (coach_profile_id, language_code) values (v_profile, 'ro'), (v_profile, 'en');
  insert into public.coach_locations (coach_profile_id, city_id)
  select v_profile, c.id from public.cities c where c.slug = 'cluj-napoca' limit 1;
  insert into public.coach_services (coach_profile_id, name, description, kind, delivery, price_cents, currency, price_unit, price_public, active, sort_order)
  values (v_profile, 'E2E online coaching', 'Monthly plan and weekly check-in.', 'online_coaching', 'online', 30000, 'RON', 'month', true, true, 0);
  update public.coach_profiles set status = 'published', published_at = now(), submitted_at = now(), reviewed_at = now()
  where id = v_profile;
  -- coach B's stays a draft
  update public.coach_profiles set slug = 'e2e-coach-beta', headline = 'Draft coach, never published' where user_id = coach_b;

  -- client A: a published program with a day and an exercise, and a published plan with a meal
  insert into public.programs (coach_id, client_id, name, status) values (coach_a, client_a, 'E2E Alpha Program', 'published')
    returning id into v_program;
  insert into public.program_days (program_id, week_index, day_index, name) values (v_program, 1, 1, 'Alpha Day 1') returning id into v_day;
  insert into public.program_exercises (program_day_id, exercise_id, position, target_sets, target_reps) values (v_day, v_ex, 0, 3, '8');
  insert into public.nutrition_plans (coach_id, client_id, name, status, kcal_target, protein_target_g, carbs_target_g, fat_target_g)
    values (coach_a, client_a, 'E2E Alpha Plan', 'published', 2200, 150, 220, 70) returning id into v_plan;
  insert into public.planned_meals (plan_id, slot, name, position) values (v_plan, 'breakfast', 'Breakfast', 0);

  -- client D: the same, then the coaching ends — A keeps reading it, may no longer change it
  insert into public.programs (coach_id, client_id, name, status) values (coach_a, client_d, 'E2E Ended Program', 'published')
    returning id into v_program;
  insert into public.program_days (program_id, week_index, day_index, name) values (v_program, 1, 1, 'Ended Day 1');
  insert into public.nutrition_plans (coach_id, client_id, name, status, kcal_target, protein_target_g, carbs_target_g, fat_target_g)
    values (coach_a, client_d, 'E2E Ended Plan', 'published', 2000, 140, 200, 60) returning id into v_plan;
  insert into public.planned_meals (plan_id, slot, name, position) values (v_plan, 'lunch', 'Lunch', 0);
  update public.trainer_clients set status = 'ended', ended_at = now(), ended_by = coach_a
   where coach_id = coach_a and client_id = client_d;

  -- client E: coached by B, who wrote a program and a plan; then the client paused the coaching
  insert into public.trainer_clients (coach_id, client_id, status, started_at) values (coach_b, client_e, 'active', now() - interval '20 days');
  insert into public.programs (coach_id, client_id, name, status) values (coach_b, client_e, 'E2E Paused Program', 'published')
    returning id into v_program;
  insert into public.program_days (program_id, week_index, day_index, name) values (v_program, 1, 1, 'Paused Day 1');
  insert into public.nutrition_plans (coach_id, client_id, name, status, kcal_target, protein_target_g, carbs_target_g, fat_target_g)
    values (coach_b, client_e, 'E2E Paused Plan', 'published', 2100, 130, 210, 65) returning id into v_plan;
  insert into public.planned_meals (plan_id, slot, name, position) values (v_plan, 'dinner', 'Dinner', 0);
  update public.trainer_clients set status = 'paused', paused_at = now(), paused_by = client_e, pause_reason = 'vacation'
   where coach_id = coach_b and client_id = client_e;

  -- client F: coached by B (active), a program with one day — the stale-editor case
  insert into public.trainer_clients (coach_id, client_id, status, started_at) values (coach_b, client_f, 'active', now() - interval '10 days');
  insert into public.programs (coach_id, client_id, name, status) values (coach_b, client_f, 'E2E Stale Program', 'published')
    returning id into v_program;
  insert into public.program_days (program_id, week_index, day_index, name) values (v_program, 1, 1, 'Stale Day 1');

  -- the soak trio: a published coach (made as coach A's is), one active client, one solo
  insert into public.trainer_clients (coach_id, client_id, status, started_at) values (soak_coach, soak_client, 'active', now() - interval '14 days');
  insert into public.conversations (coach_id, client_id) values (soak_coach, soak_client) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', soak_coach::text, 'role', 'authenticated')::text, true);
  perform public.become_coach();
  perform set_config('request.jwt.claims', '', true);
  select id into v_profile from public.coach_profiles where user_id = soak_coach;
  update public.coach_profiles set slug = 'e2e-soak-coach',
    headline = 'Soak-test coach for the local round-after-round suite',
    about = 'A seeded coach the soak suite plays against. Not a real person; this database is thrown away.',
    coaching_since = 2018, online = true, in_person = false, accepting_clients = true
  where id = v_profile;
  insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
  select v_profile, s.id, true from public.specializations s where s.slug = 'strength';
  insert into public.coach_languages (coach_profile_id, language_code) values (v_profile, 'ro'), (v_profile, 'en');
  insert into public.coach_services (coach_profile_id, name, description, kind, delivery, price_cents, currency, price_unit, price_public, active, sort_order)
  values (v_profile, 'Soak online coaching', 'Plan and weekly check-in.', 'online_coaching', 'online', 25000, 'RON', 'month', true, true, 0);
  update public.coach_profiles set status = 'published', published_at = now(), submitted_at = now(), reviewed_at = now()
  where id = v_profile;

  -- everyone but the two new accounts is past the welcome cards, like an account the migration found
  insert into public.onboarding_state (user_id, state)
  select u.id, jsonb_build_object('welcome', 'done') from public.users u
   where u.id not in (new_client, new_coach)
  on conflict (user_id) do nothing;
end
$seed$;

-- A fault the nutrition spec can trigger from the UI without mocking anything:
-- creating a plan whose name carries the marker makes the real meal-slot insert
-- fail inside the real database, as a dropped connection or a constraint would.
create or replace function public.e2e_fail_meal_slots() returns trigger language plpgsql as $f$
begin
  if exists (select 1 from public.nutrition_plans n where n.id = new.plan_id and n.name like '%[e2e:fail-meals]%') then
    raise exception 'E2E_INJECTED_MEAL_FAILURE';
  end if;
  return new;
end;
$f$;
revoke execute on function public.e2e_fail_meal_slots() from public, anon, authenticated;
create trigger e2e_fail_meal_slots before insert on public.planned_meals
  for each row execute function public.e2e_fail_meal_slots();

commit;
