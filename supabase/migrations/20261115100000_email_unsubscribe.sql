-- Marketplace email · unsubscribe links (docs/MARKETPLACE_EMAIL.md §6).
--
-- Every email carries a link that switches off its own category with one
-- click, no sign-in: /unsubscribe?u=<user>&c=<category>&t=<token>, and the
-- same URL under /unsubscribe/one-click for the List-Unsubscribe header
-- (RFC 8058, which Gmail and Yahoo require).
--
-- The token is an HMAC of "<user id>:<category>" under a key generated here,
-- inside the database. It never leaves it: email_outbox_rows() signs (the
-- dispatcher receives finished tokens, never the key) and email_unsubscribe()
-- verifies. So there is no secret to set in Supabase Secrets, Vault or Vercel,
-- and nobody can unsubscribe someone else by editing a link.
--
-- pgcrypto lives in `extensions` on Supabase; the functions keep
-- `search_path = public` and call it schema-qualified
-- (see 20260914100000_invite_code_without_pgcrypto.sql).

-- ---------- 1. the signing key: one row, nobody but the database reads it ----------
create table public.email_signing_key (
  id boolean primary key default true check (id),
  secret bytea not null check (length(secret) >= 32),
  created_at timestamptz not null default now()
);
alter table public.email_signing_key enable row level security;
revoke all on public.email_signing_key from public, anon, authenticated;

insert into public.email_signing_key (secret)
values (extensions.gen_random_bytes(32))
on conflict (id) do nothing;

-- ---------- 2. the token ----------
-- The categories a person can switch off: one per email switch
-- (EMAIL_PREF_CATEGORIES in packages/shared/src/marketplace-email.ts;
-- apps/web/lib/email-outbox-rules.test.ts keeps the lists equal).
create or replace function public.email_pref_category_ok(p_category text)
returns boolean language sql immutable set search_path = public as $$
  select p_category in ('coaching_request', 'booking', 'new_message', 'review', 'marketplace');
$$;
revoke execute on function public.email_pref_category_ok(text) from public, anon, authenticated;

-- 128 bits of HMAC-SHA256, hex: short enough for a link, far past guessing.
create or replace function public.email_unsubscribe_token(p_user uuid, p_category text)
returns text language sql stable security definer set search_path = public as $$
  select left(encode(extensions.hmac(convert_to(p_user::text || ':' || p_category, 'UTF8'), k.secret, 'sha256'), 'hex'), 32)
    from public.email_signing_key k
   where k.id;
$$;
revoke execute on function public.email_unsubscribe_token(uuid, text) from public, anon, authenticated;

-- ---------- 3. the dispatcher's rows now carry user id + token ----------
-- A different result shape needs drop + create; claim and peek return the
-- same shape, so they go too. Bodies are unchanged from 20261114100000
-- except the two new columns.
drop function if exists public.email_outbox_claim(int);
drop function if exists public.email_outbox_peek(int);
drop function if exists public.email_outbox_rows(uuid[]);

create function public.email_outbox_rows(p_ids uuid[])
returns table (
  id uuid, notification_id uuid, attempts int, category text, payload jsonb, created_at timestamptz,
  read_at timestamptz, email text, email_confirmed boolean, locale text, time_zone text, prefs jsonb,
  suspended boolean, deletion_requested boolean, actor_name text, starts_at timestamptz,
  user_id uuid, unsubscribe_token text
) language sql stable security definer set search_path = public as $$
  select o.id, o.notification_id, o.attempts, n.category::text, n.payload, n.created_at, n.read_at,
         au.email, au.email_confirmed_at is not null, u.locale, u.timezone, u.notification_prefs,
         u.suspended_at is not null,
         exists (select 1 from public.account_deletion_requests d where d.user_id = o.user_id),
         (select public.public_display_name(a.username, a.full_name) from public.users a
           where (n.payload ->> 'actor_id') ~ '^[0-9a-f-]{36}$' and a.id = (n.payload ->> 'actor_id')::uuid),
         (select b.start_at from public.bookings b
           where n.category = 'booking' and (n.payload ->> 'booking_id') ~ '^[0-9a-f-]{36}$'
             and b.id = (n.payload ->> 'booking_id')::uuid),
         o.user_id,
         case when public.email_pref_category_ok(n.category::text)
              then public.email_unsubscribe_token(o.user_id, n.category::text) end
    from public.email_outbox o
    join public.notifications n on n.id = o.notification_id
    join public.users u on u.id = o.user_id
    left join auth.users au on au.id = o.user_id
   where o.id = any (p_ids)
   order by o.not_before;
$$;
revoke execute on function public.email_outbox_rows(uuid[]) from public, anon, authenticated;

create function public.email_outbox_claim(p_limit int)
returns table (
  id uuid, notification_id uuid, attempts int, category text, payload jsonb, created_at timestamptz,
  read_at timestamptz, email text, email_confirmed boolean, locale text, time_zone text, prefs jsonb,
  suspended boolean, deletion_requested boolean, actor_name text, starts_at timestamptz,
  user_id uuid, unsubscribe_token text
) language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  with picked as (
    select o.id from public.email_outbox o
     where (o.status in ('pending', 'retry') and o.not_before <= now())
        or (o.status = 'sending' and o.locked_until < now())
     order by o.not_before
     limit greatest(1, least(coalesce(p_limit, 20), 50))
     for update skip locked
  ), claimed as (
    update public.email_outbox o
       set status = 'sending', locked_until = now() + interval '5 minutes', updated_at = now()
      from picked where o.id = picked.id
    returning o.id
  )
  select coalesce(array_agg(claimed.id), '{}') into v_ids from claimed;
  return query select * from public.email_outbox_rows(v_ids);
end;
$$;

create function public.email_outbox_peek(p_limit int)
returns table (
  id uuid, notification_id uuid, attempts int, category text, payload jsonb, created_at timestamptz,
  read_at timestamptz, email text, email_confirmed boolean, locale text, time_zone text, prefs jsonb,
  suspended boolean, deletion_requested boolean, actor_name text, starts_at timestamptz,
  user_id uuid, unsubscribe_token text
) language sql stable security definer set search_path = public as $$
  select * from public.email_outbox_rows(array(
    select o.id from public.email_outbox o
     where o.status in ('pending', 'retry') and o.not_before <= now()
     order by o.not_before
     limit greatest(1, least(coalesce(p_limit, 20), 50))));
$$;

revoke execute on function public.email_outbox_claim(int) from public, anon, authenticated;
revoke execute on function public.email_outbox_peek(int) from public, anon, authenticated;
grant execute on function public.email_outbox_claim(int) to service_role;
grant execute on function public.email_outbox_peek(int) to service_role;

-- ---------- 4. the one-click unsubscribe: the only anonymous door here ----------
-- Sets users.notification_prefs.email.<category> = false and keeps every other
-- key (the top-level ones are push switches). Answers only true/false: whether
-- the link was valid. It never says whether an account exists, and reveals
-- nothing about the person.
create or replace function public.email_unsubscribe(p_user uuid, p_category text, p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_expected text;
begin
  if p_user is null or p_token is null or not public.email_pref_category_ok(p_category)
     or p_token !~ '^[0-9a-f]{32}$' then
    return false;
  end if;
  v_expected := public.email_unsubscribe_token(p_user, p_category);
  if v_expected is null or v_expected <> p_token then
    return false;
  end if;
  update public.users u
     set notification_prefs = coalesce(u.notification_prefs, '{}'::jsonb)
           || jsonb_build_object('email',
                (case when jsonb_typeof(u.notification_prefs -> 'email') = 'object'
                      then u.notification_prefs -> 'email' else '{}'::jsonb end)
                || jsonb_build_object(p_category, false))
   where u.id = p_user;
  -- a deleted account has nothing left to unsubscribe: the link still "worked"
  return true;
end;
$$;
revoke execute on function public.email_unsubscribe(uuid, text, text) from public;
grant execute on function public.email_unsubscribe(uuid, text, text) to anon, authenticated, service_role;
