-- HealthApp · un antrenor demo publicat, ca să vezi cum arată marketplace-ul
--
-- Paste into the Supabase dashboard → SQL Editor → Run (it connects as `postgres`).
-- Safe to re-run: the account is reused and its profile refreshed.
--
--   sign in:  demo-coach@healthapp.test  /  HealthApp!Dev2026
--   page:     /coaches/antrenor-demo
--
-- Deliberately NOT a fake person: the headline says "profil demo", there are no
-- reviews (a made-up rating on a public marketplace would mislead real visitors),
-- and there is no avatar — so the page is `noindex` and stays out of the sitemap
-- (coachIndexable() / coach_sitemap() both require one). Bookable Mon–Fri
-- 09:00–17:00 Europe/Bucharest, so the Book flow works end to end.
--
-- Needs the marketplace migrations through 20261112100000 for the approach /
-- goals / links fields; without them those fields are simply skipped.
--
-- Remove everything again (profile, services, hours… cascade with the account):
--   delete from auth.users where email = 'demo-coach@healthapp.test';

set search_path = public, extensions;

do $$
declare
  v_email    text := 'demo-coach@healthapp.test';
  v_password text := 'HealthApp!Dev2026';
  v_id       uuid;
  v_profile  uuid;
begin
  -- ---------- the account ----------
  select id into v_id from auth.users where email = v_email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_email, crypt(v_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Antrenor Demo', 'username', 'antrenor_demo'), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id,
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
            'email', now(), now(), now());
  else
    update auth.users set encrypted_password = crypt(v_password, gen_salt('bf')),
                          email_confirmed_at = coalesce(email_confirmed_at, now())
     where id = v_id;
  end if;

  update public.users
     set username = coalesce(username, 'antrenor_demo'), full_name = 'Antrenor Demo',
         timezone = 'Europe/Bucharest', city = 'Cluj-Napoca'
   where id = v_id;

  -- ---------- the coach profile (become_coach() makes it, as the app does) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  perform public.become_coach();
  perform set_config('request.jwt.claims', '', true);
  select id into v_profile from public.coach_profiles where user_id = v_id;

  update public.coach_profiles set
    slug = 'antrenor-demo',
    headline = 'Antrenor personal și coach online (profil demo)',
    about = 'Acesta este un profil demonstrativ Voinic, creat ca să vezi cum arată pagina unui antrenor: '
         || 'specializări, servicii, prețuri, disponibilitate și programare. Nu este o persoană reală și nu '
         || 'primește clienți reali. Lucrez cu începători și cu oameni care revin la sală după o pauză, '
         || 'cu antrenamente de forță simple, check-in săptămânal și obiective realiste.',
    coaching_since = 2018,
    online = true, in_person = true, accepting_clients = true
  where id = v_profile;

  delete from public.coach_specializations where coach_profile_id = v_profile;
  insert into public.coach_specializations (coach_profile_id, specialization_id, is_primary)
  select v_profile, s.id, s.slug = 'strength' from public.specializations s
   where s.slug in ('strength', 'beginners', 'weight-loss');

  delete from public.coach_languages where coach_profile_id = v_profile;
  insert into public.coach_languages (coach_profile_id, language_code)
  select v_profile, l.code from public.languages l where l.code in ('ro', 'en');

  delete from public.coach_locations where coach_profile_id = v_profile;
  insert into public.coach_locations (coach_profile_id, city_id)
  select v_profile, c.id from public.cities c where c.slug = 'cluj-napoca' limit 1;

  -- services: no booking or request points at a demo, so they are replaced whole
  delete from public.coach_services sv where sv.coach_profile_id = v_profile
     and not exists (select 1 from public.bookings b where b.service_id = sv.id)
     and not exists (select 1 from public.coaching_requests r where r.service_id = sv.id);
  insert into public.coach_services (coach_profile_id, name, description, kind, delivery, duration_value, duration_unit,
                                     price_cents, currency, price_unit, price_public, active, sort_order)
  values
    (v_profile, 'Sesiune de antrenament 1:1', 'O oră de antrenament ghidat, online sau la sală.',
     'personal_training', 'hybrid', 60, 'minutes', 15000, 'RON', 'session', true, true, 0),
    (v_profile, 'Coaching online lunar', 'Program personalizat, check-in săptămânal și mesaje în aplicație.',
     'online_coaching', 'online', null, null, 40000, 'RON', 'month', true, true, 1),
    (v_profile, 'Consultație de început', '30 de minute în care stabilim obiectivul și primii pași.',
     'consultation', 'online', 30, 'minutes', null, 'RON', 'free', true, true, 2);

  delete from public.coach_certifications where coach_profile_id = v_profile;
  insert into public.coach_certifications (coach_profile_id, name, issuer, year)
  values (v_profile, 'Instructor de fitness (exemplu)', 'Certificare demo', 2018);

  -- weekly hours Mon–Fri 09:00–17:00, and the 1:1 session and the consultation bookable
  delete from public.coach_availability where coach_id = v_id;
  insert into public.coach_availability (coach_id, weekday, start_time, end_time)
  select v_id, wd, '09:00', '17:00' from generate_series(1, 5) wd;
  update public.coach_services set bookable = true, booking_duration_minutes = coalesce(duration_value, 60),
         booking_buffer_after_minutes = 15, booking_access = 'public', booking_confirmation = 'approval'
   where coach_profile_id = v_profile and kind in ('personal_training', 'consultation');

  -- published straight away (as an admin approval would), never verified
  update public.coach_profiles set status = 'published', published_at = coalesce(published_at, now()),
         submitted_at = coalesce(submitted_at, now()), reviewed_at = now()
   where id = v_profile;

  -- the own-words fields, where the database has them (20261111100000)
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'coach_profiles' and column_name = 'approach') then
    execute $q$
      update public.coach_profiles set
        approach = 'Pornim de la ce poți face azi. Trei antrenamente pe săptămână, progres mic dar constant, '
                || 'un check-in scurt în fiecare duminică și ajustăm programul după cum te simți.',
        experience_summary = 'Exemplu: 6 ani de antrenament personal într-o sală din Cluj, lucru cu începători și '
                          || 'cu oameni care revin după o pauză.',
        client_goals = array['strength', 'beginners', 'return_to_training', 'general_fitness'],
        social_links = '{"instagram":"voinic.demo"}'::jsonb
      where id = $1 $q$ using v_profile;
  end if;

  -- the ranking's signals now, not in 15 minutes
  if exists (select 1 from pg_proc where proname = 'coach_rank_signals_refresh') then
    perform public.coach_rank_signals_refresh(v_profile);
  end if;
end;
$$;

select cp.slug, cp.status, u.username from public.coach_profiles cp join public.users u on u.id = cp.user_id
 where cp.slug = 'antrenor-demo';
