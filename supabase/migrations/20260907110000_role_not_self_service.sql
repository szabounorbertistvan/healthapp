-- HealthApp schema · role is not self-service
--
-- Two changes, one subject.
--
-- 1. users_update (rls.sql) lets a user update their own row, and the table
--    grant in 20260826075027 covered every column — `role` included. A PATCH
--    on /rest/v1/users could have made any signed-in user an admin. The grant
--    is now column-level and `role` is not on the list. Security-definer
--    functions (handle_new_user, claim_signup_role, admin_set_tier) are the
--    only writers.
--
-- 2. Google sign-in cannot carry user metadata, so the coach/client choice
--    made on the login page arrives after the fact, as `?role=` on
--    /auth/callback. The callback calls claim_signup_role(). It only touches a
--    row created in the last 10 minutes — i.e. the sign-up that just happened —
--    and only ever sets coach or client. Self-declared, exactly like the email
--    form; still never admin, and never a demotion of one.

revoke update on table public.users from authenticated;
grant update (full_name, avatar_url, locale, weight_unit, length_unit, timezone,
              check_in_weekday, notification_prefs, push_token)
  on table public.users to authenticated;

create or replace function public.claim_signup_role(p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role not in ('coach', 'client') then
    raise exception 'role must be coach or client' using errcode = '22023';
  end if;
  update public.users
     set role = p_role::user_role
   where id = auth.uid()
     and created_at > now() - interval '10 minutes'
     and role in ('coach', 'client');
end;
$$;
grant execute on function public.claim_signup_role(text) to authenticated;
