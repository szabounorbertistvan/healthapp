-- HealthApp schema · signup role
--
-- The login page lets a new user say whether they are a coach or a client, and
-- passes it as `role` in the sign-up metadata. The profile trigger reads it here.
--
-- Only 'coach' and 'client' are accepted. Metadata is client-supplied, so
-- anything else — 'admin' above all — falls back to the column default
-- ('client'). Admin stays something only SQL grants.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.users (id, full_name, avatar_url, role)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
          new.raw_user_meta_data ->> 'avatar_url',
          case when requested in ('coach', 'client')
               then requested::user_role
               else 'client'::user_role end);
  return new;
end;
$$;
