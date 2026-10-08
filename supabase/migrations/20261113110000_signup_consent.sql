-- Consent at sign-up (launch audit 2026-10-08, §5 / §10).
--
-- Voinic processes health data — training logs, food, body measurements,
-- progress photos — which is a GDPR Art. 9 special category. Its lawful basis
-- here is explicit consent (9(2)(a)), separate from accepting the Terms, and
-- it has to be recorded. Three columns on users:
--
--   terms_accepted_at       the Terms and the Privacy Policy were accepted
--   health_data_consent_at  the explicit Art. 9 consent was given
--   consent_version         which text was agreed to (lib/legal.ts, CONSENT_VERSION)
--
-- They are set in exactly two ways, both by the database:
--   * an email sign-up carries `consent_version` in its user metadata (the form
--     will not submit without both boxes ticked), and the trigger below stamps
--     the row the moment it exists;
--   * anyone else — a Google sign-up, every account from before today — calls
--     accept_consent() from /complete-profile, which both layouts send them to
--     while health_data_consent_at is null.
-- No column grant: nobody writes these through PostgREST directly.

alter table public.users
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists health_data_consent_at timestamptz,
  add column if not exists consent_version text
    check (consent_version is null or consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- Fires after on_auth_user_created (triggers run in name order), so the
-- public.users row already exists.
create or replace function public.handle_new_user_consent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_version text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'consent_version', '')), '');
begin
  if v_version is null or v_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return new;
  end if;
  update public.users
     set terms_accepted_at = now(), health_data_consent_at = now(), consent_version = v_version
   where id = new.id;
  return new;
end;
$$;
revoke execute on function public.handle_new_user_consent() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_consent on auth.users;
create trigger on_auth_user_created_consent
  after insert on auth.users
  for each row execute function public.handle_new_user_consent();

-- The signed-in person agrees to `p_version`. Re-agreeing to a newer version
-- moves the stamps forward; it never clears them.
create or replace function public.accept_consent(p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '42501';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'BAD_VERSION' using errcode = '22023';
  end if;
  update public.users
     set terms_accepted_at = now(), health_data_consent_at = now(), consent_version = p_version
   where id = auth.uid();
end;
$$;
revoke execute on function public.accept_consent(text) from public, anon;
grant execute on function public.accept_consent(text) to authenticated;
