-- HealthApp schema · profile extras + role choice on complete-profile
--
-- Two subjects, both from the same feedback: "after signing in I should be able
-- to fill in my profile", and "a Google sign-up never got to say whether it is
-- a coach or a client".
--
-- 1. `users` grows `city` and `bio`, editable by the person themselves like the
--    other profile columns (the update grant is column-level since
--    20260907110000). `avatar_url` already exists; the app now lets the person
--    upload one instead of only inheriting Google's. Both new columns are
--    hidden with the rest of the profile when deletion is requested.
--
-- 2. claim_signup_role() only acted on a row created in the last 10 minutes,
--    which is what the login page's Google button needed. But the "sign in"
--    tab of that page also creates accounts on first consent, with no role
--    choice at all — those land on /complete-profile as clients. A sign-up is
--    not finished until the profile is: the function now also accepts a row
--    whose `username` is still null, which is exactly the set of accounts the
--    layouts send to /complete-profile. Still coach or client only, still never
--    touching an admin, and no longer possible once the profile is complete.

alter table public.users
  add column city text check (city is null or length(city) <= 80),
  add column bio  text check (bio  is null or length(bio)  <= 500);

comment on column public.users.city is 'Free-text locality shown on the profile; nothing is keyed on it.';
comment on column public.users.bio  is 'Short self-description shown on the profile.';

grant update (city, bio) on table public.users to authenticated;

create or replace function public.claim_signup_role(p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role not in ('coach', 'client') then
    raise exception 'role must be coach or client' using errcode = '22023';
  end if;
  update public.users
     set role = p_role::user_role
   where id = auth.uid()
     and (created_at > now() - interval '10 minutes' or username is null)
     and role in ('coach', 'client');
end;
$$;

-- Same body as 20260916110000, plus the two new columns.
create or replace function public.request_account_deletion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_purge timestamptz;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  insert into public.account_deletion_requests (user_id)
  values (v_user)
  on conflict (user_id) do update set requested_at = now()
  returning purge_after into v_purge;

  update public.users
  set full_name = 'Deleted user',
      -- users_username_format caps the handle at 24 characters, so this is
      -- 'deleted_' plus 16 hex of the uuid — exactly 24, and unique in practice.
      username = 'deleted_' || substr(replace(v_user::text, '-', ''), 1, 16),
      avatar_url = null,
      city = null,
      bio = null,
      push_token = null
  where id = v_user;

  update public.trainer_clients
  set status = 'ended', ended_at = coalesce(ended_at, now())
  where status in ('invited', 'active')
    and (client_id = v_user or coach_id = v_user);

  return jsonb_build_object('status', 'pending', 'purge_after', v_purge);
end;
$$;
