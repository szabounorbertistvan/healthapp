-- Admin: change a person's username (2026-11-24)
--
-- The person can already change their own on /account (profile-actions.ts);
-- this is the admin's door for the same column, from /admin/users/[id].
-- Same rules as the sign-up trigger and the profile form: the format check
-- users_username_format, and one username per spelling regardless of case
-- (users_username_lower_idx). Checked here first so the app gets a named
-- error instead of a raw 23514 / 23505.
--
-- Nothing else is keyed on the username: a coach's public slug was derived
-- from it once (coach_slug_base) and stays, and old @mentions in posts keep
-- the text they were written with.

create or replace function public.admin_set_username(p_user uuid, p_username text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_new text := trim(p_username);
begin
  perform public.admin_assert();
  select username into v_old from public.users where id = p_user;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = '22023';
  end if;
  if v_new is null or v_new !~ '^[A-Za-z0-9][A-Za-z0-9_.]{2,23}$' then
    raise exception 'USERNAME_FORMAT' using errcode = '22023';
  end if;
  if v_old is not distinct from v_new then
    return v_new;
  end if;
  if exists (select 1 from public.users where lower(username) = lower(v_new) and id <> p_user) then
    raise exception 'USERNAME_TAKEN' using errcode = '22023';
  end if;
  update public.users set username = v_new where id = p_user;
  perform public.audit_log('ADMIN_ACTION', 'user', p_user::text, p_user,
    jsonb_build_object('kind', 'set_username', 'from', v_old, 'to', v_new));
  return v_new;
end;
$$;
revoke execute on function public.admin_set_username(uuid, text) from public, anon;
grant execute on function public.admin_set_username(uuid, text) to authenticated;
