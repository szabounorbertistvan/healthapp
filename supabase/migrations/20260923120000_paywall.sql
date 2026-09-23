-- Paywall: one switch, a tier a client can inherit from their coach, and the
-- plan limits SQL enforces.
--
-- 1. app_flags.paywall — the switch. Off, every feature is open to everyone
--    (the app's planEntitlements() answers the role's full paid set) and the
--    limit triggers below let everything through. `preview_users` turns it on
--    for a handful of accounts first, so the gates can be seen live without
--    gating anyone else:
--      update public.app_flags set preview_users = array['<uuid>']::uuid[] where key = 'paywall';
--      update public.app_flags set enabled = true where key = 'paywall';   -- everyone
--    create_invite's roster cap (3 / 30) predates the switch and ignores it.
--
-- 2. own_tier() is what effective_tier() used to be, with one fix: a coach
--    whose trial ended is Coach Starter, not the client "free" tier.
--    effective_tier() adds the inheritance: a client of an active coach whose
--    *own* tier is coach_pro is premium. Mirrored in packages/shared
--    (billing.ts effectiveTier).
--
-- 3. plan_limit() mirrors the numeric limits in packages/shared
--    entitlements.ts (ENTITLEMENTS; entitlements.test.ts pins both).

-- ---------- the switch ----------
create table if not exists public.app_flags (
  key text primary key,
  enabled boolean not null default false,
  preview_users uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
-- No policies on purpose: people read it only through paywall_on() / my_plan,
-- and it is flipped from the SQL editor or the CLI.
revoke all on public.app_flags from anon, authenticated;

insert into public.app_flags (key) values ('paywall') on conflict (key) do nothing;

create or replace function public.paywall_on(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select f.enabled or uid = any (f.preview_users) from public.app_flags f where f.key = 'paywall'),
    false
  );
$$;

-- ---------- tiers ----------
create or replace function public.own_tier(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when s.status = 'active' and s.tier <> 'free' then s.tier
    when s.trial_ends_at > now() then
      case when u.role in ('coach', 'both', 'admin') then 'coach_pro' else 'premium' end
    when u.role in ('coach', 'both', 'admin') then 'coach_free'
    else 'free'
  end
  from public.users u
  left join public.subscriptions s on s.user_id = u.id
  where u.id = uid;
$$;

-- Only a plain client (own tier 'free') inherits, and only from the coach's
-- own tier — never from what that coach might inherit in turn.
create or replace function public.effective_tier(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when t.own = 'free' and exists (
      select 1 from public.trainer_clients tc
      where tc.client_id = uid
        and tc.status = 'active'
        and public.own_tier(tc.coach_id) = 'coach_pro'
    ) then 'premium'
    else t.own
  end
  from (select public.own_tier(uid) as own) t;
$$;

-- ---------- limits ----------
-- null = unlimited. Keys: own_programs, custom_exercises, favorite_foods, barcode_scans_day.
create or replace function public.plan_limit(p_tier text, p_key text)
returns int language sql immutable as $$
  select case p_tier
    when 'free' then case p_key
      when 'own_programs' then 1
      when 'custom_exercises' then 3
      when 'favorite_foods' then 10
      when 'barcode_scans_day' then 5
    end
    when 'coach_free' then case p_key
      when 'own_programs' then 1
      when 'custom_exercises' then 10
      when 'favorite_foods' then 10
      when 'barcode_scans_day' then 5
    end
  end;
$$;

-- The limit that applies to this person right now: none while the paywall is off for them.
create or replace function public.user_plan_limit(uid uuid, p_key text)
returns int language sql stable security definer set search_path = public as $$
  select case when public.paywall_on(uid) then public.plan_limit(public.effective_tier(uid), p_key) end;
$$;

-- One trigger function for the three counted tables; tg_argv[0] names the limit.
-- Existing rows over a limit (someone who downgraded) stay — only a new one is refused.
create or replace function public.enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_key text := tg_argv[0];
  v_uid uuid;
  v_limit int;
  v_used int;
begin
  -- Service role, migrations, seeds and the SQL editor carry no JWT: they are not a person on a plan.
  if auth.uid() is null then
    return new;
  end if;

  if v_key = 'own_programs' then
    if new.coach_id is not null then return new; end if;  -- a coach's program for a client is not "own"
    v_uid := new.client_id;
  elsif v_key = 'custom_exercises' then
    if new.owner_id is null then return new; end if;      -- the shared library
    v_uid := new.owner_id;
  elsif v_key = 'favorite_foods' then
    v_uid := new.user_id;
  else
    raise exception 'enforce_plan_limit: unknown key %', v_key;
  end if;

  v_limit := public.user_plan_limit(v_uid, v_key);
  if v_limit is null then
    return new;
  end if;

  if v_key = 'own_programs' then
    select count(*) into v_used from public.programs where client_id = v_uid and coach_id is null;
  elsif v_key = 'custom_exercises' then
    select count(*) into v_used from public.exercises where owner_id = v_uid;
  else
    select count(*) into v_used from public.food_favorites where user_id = v_uid;
  end if;

  if v_used >= v_limit then
    raise exception 'PLAN_LIMIT_REACHED' using hint = v_key;
  end if;
  return new;
end;
$$;

drop trigger if exists programs_plan_limit on public.programs;
create trigger programs_plan_limit before insert on public.programs
  for each row execute function public.enforce_plan_limit('own_programs');

drop trigger if exists exercises_plan_limit on public.exercises;
create trigger exercises_plan_limit before insert on public.exercises
  for each row execute function public.enforce_plan_limit('custom_exercises');

drop trigger if exists food_favorites_plan_limit on public.food_favorites;
create trigger food_favorites_plan_limit before insert on public.food_favorites
  for each row execute function public.enforce_plan_limit('favorite_foods');

-- ---------- barcode scans per day ----------
-- A counter per person per local day. Nobody reads or writes it directly;
-- claim_barcode_scan() is the only way in, called by lookupBarcode before the
-- cache or Open Food Facts is asked.
create table if not exists public.barcode_scans (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null,
  scans int not null default 0 check (scans >= 0),
  primary key (user_id, day)
);
alter table public.barcode_scans enable row level security;
revoke all on public.barcode_scans from anon, authenticated;

-- Counts one scan and answers how many are left today (null = unlimited), or
-- raises PLAN_LIMIT_REACHED without counting when none are.
create or replace function public.claim_barcode_scan()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
  v_limit int;
  v_scans int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select (now() at time zone coalesce(nullif(u.timezone, ''), 'UTC'))::date into v_day
  from public.users u where u.id = v_uid;
  v_day := coalesce(v_day, current_date);
  v_limit := public.user_plan_limit(v_uid, 'barcode_scans_day');

  insert into public.barcode_scans as b (user_id, day, scans) values (v_uid, v_day, 1)
  on conflict (user_id, day) do update set scans = b.scans + 1
    where v_limit is null or b.scans < v_limit
  returning scans into v_scans;

  if v_scans is null then
    raise exception 'PLAN_LIMIT_REACHED' using hint = 'barcode_scans_day';
  end if;
  return case when v_limit is null then null else v_limit - v_scans end;
end;
$$;
revoke execute on function public.claim_barcode_scan() from public, anon;
grant execute on function public.claim_barcode_scan() to authenticated;

-- ---------- what the app reads ----------
-- One row, the signed-in person's: their effective tier, whether it comes
-- through their coach, whether the paywall applies to them, and the
-- subscription fields getProfile used to select from `subscriptions`. A
-- definer view so the coach's tier (a row the client cannot read) can count,
-- scoped to auth.uid() so it never shows anyone else. It replaces the
-- subscriptions select in getProfile one for one — no extra round trip.
create or replace view public.my_plan with (security_invoker = false) as
select
  u.id as user_id,
  public.effective_tier(u.id) as tier,
  public.own_tier(u.id) as own_tier,
  public.paywall_on(u.id) as paywall,
  s.status,
  s.trial_ends_at,
  (s.stripe_customer_id is not null) as has_stripe
from public.users u
left join public.subscriptions s on s.user_id = u.id
where u.id = auth.uid();

revoke all on public.my_plan from anon, authenticated;
grant select on public.my_plan to authenticated;

notify pgrst, 'reload schema';
