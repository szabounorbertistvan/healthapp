-- HealthApp · dev accounts (admin / trainer / client)
--
-- Paste into the Supabase dashboard → SQL Editor → Run. The editor connects as
-- `postgres`, which is what this needs: `users.role` has no self-update policy
-- and `trainer_clients` rows are service-role writes by design.
--
-- Equivalent to `npm run seed:accounts`, minus the service_role key. Safe to
-- re-run — existing accounts get their password reset instead of duplicated.
--
-- Passwords are hashed by pgcrypto here, exactly as GoTrue would; the plaintext
-- below never reaches the database. Change it before running if you like.

set search_path = public, extensions;  -- pgcrypto lives in one of these

do $$
declare
  v_password  text := 'HealthApp!Dev2026';
  a           record;
  v_id        uuid;
begin
  for a in
    select * from (values
      ('admin@healthapp.test',   'Admin HealthApp', 'admin'),
      ('trainer@healthapp.test', 'Andrei Trainer',  'coach'),
      ('client@healthapp.test',  'Maria Client',    'client')
    ) as t (email, full_name, role)
  loop
    select id into v_id from auth.users where email = a.email;

    if v_id is null then
      v_id := gen_random_uuid();

      -- email_confirmed_at is stamped directly: these are test accounts on a
      -- .test domain, so no confirmation mail could ever be delivered.
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        a.email, crypt(v_password, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', a.full_name), now(), now(),
        '', '', '', ''
      );

      -- password sign-in needs the matching identity row, not just the user
      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        v_id::text, v_id,
        jsonb_build_object('sub', v_id::text, 'email', a.email,
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
      );
    else
      update auth.users
         set encrypted_password = crypt(v_password, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at         = now()
       where id = v_id;
    end if;

    -- on_auth_user_created already made the profile (and its 30-day trial);
    -- it just cannot know the role, which always defaults to 'client'.
    update public.users
       set role = a.role::user_role, full_name = a.full_name
     where id = v_id;
  end loop;
end $$;

-- trainer coaches client. one_active_coach_per_client is a partial unique
-- index, so this must not fire when the client already has an active coach.
insert into public.trainer_clients (coach_id, client_id, status, started_at)
select coach.id, client.id, 'active', now()
from public.users coach, public.users client
where coach.id  = (select id from auth.users where email = 'trainer@healthapp.test')
  and client.id = (select id from auth.users where email = 'client@healthapp.test')
  and not exists (
    select 1 from public.trainer_clients tc
    where tc.client_id = client.id and tc.status = 'active'
  );

select u.full_name, u.role, au.email, au.email_confirmed_at is not null as confirmed
from public.users u join auth.users au on au.id = u.id
where au.email like '%@healthapp.test'
order by u.role;
