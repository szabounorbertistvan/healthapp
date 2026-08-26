-- BuddyGym schema · 13 Stripe billing
-- Payments arrive earlier than planned, and with Stripe rather than RevenueCat.
-- The subscriptions table stays the ONE entitlement source: the stripe-webhook
-- edge function writes here with the service role, admins write through
-- admin_set_tier, and nothing else may write (no RLS insert/update policies).
--
-- Trial model (product decision 2026-08-26): 30 days, NO card upfront. The
-- trial is app-managed — trial_ends_at is stamped at signup and effective_tier
-- grants the role's full paid tier until it passes. Stripe is only involved
-- once the user actually subscribes.

alter table public.subscriptions
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists stripe_price_id text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists trial_ends_at timestamptz;

-- new profiles start their 30-day trial at signup
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id, trial_ends_at)
  values (new.id, now() + interval '30 days')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- existing free users get their trial window starting today
update public.subscriptions
set trial_ends_at = now() + interval '30 days'
where trial_ends_at is null and tier = 'free';

-- ---------- effective tier ----------
-- Mirrored in packages/shared/src/billing.ts (effectiveTier): a paid/granted
-- tier wins; otherwise an unexpired trial grants the role's full paid tier;
-- otherwise free. security definer so gating functions can read regardless of
-- the caller's RLS visibility.
create or replace function public.effective_tier(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when s.status = 'active' and s.tier <> 'free' then s.tier
    when s.trial_ends_at > now() then
      case when u.role in ('coach', 'both', 'admin') then 'coach_pro' else 'premium' end
    else 'free'
  end
  from public.users u
  left join public.subscriptions s on s.user_id = u.id
  where u.id = uid;
$$;

-- create_invite's client limit now honors trials and lapsed subscriptions
create or replace function public.create_invite()
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(encode(gen_random_bytes(4), 'hex'));
  v_row public.trainer_clients;
  v_tier text := public.effective_tier(auth.uid());
  v_limit int;
  v_used int;
begin
  v_limit := case coalesce(v_tier, 'free') when 'coach_pro' then 30 else 3 end;

  select count(*) into v_used from public.trainer_clients
  where coach_id = auth.uid() and status in ('invited', 'active');
  if v_used >= v_limit then
    raise exception 'CLIENT_LIMIT_REACHED';
  end if;

  insert into public.trainer_clients (coach_id, status, invite_code, invite_expires_at)
  values (auth.uid(), 'invited', v_code, now() + interval '30 days')
  returning * into v_row;
  return query select v_row.id, v_row.invite_code, v_row.invite_expires_at;
end;
$$;

-- ---------- admin comp grants ----------
-- Admins can hand out (or revoke) any tier for free, bypassing Stripe.
-- Stripe columns are left untouched so a real subscription's webhook events
-- still reconcile; a later Stripe event may overwrite an admin grant.
create or replace function public.admin_set_tier(target_user uuid, new_tier text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if new_tier not in ('free', 'premium', 'coach_free', 'coach_pro') then
    raise exception 'BAD_TIER';
  end if;

  insert into public.subscriptions (user_id, tier, status, provider)
  values (target_user, new_tier, 'active',
          case when new_tier = 'free' then 'manual' else 'admin' end)
  on conflict (user_id) do update set
    tier = excluded.tier,
    status = 'active',
    provider = excluded.provider,
    current_period_end = null;
end;
$$;
