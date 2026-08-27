-- HealthApp schema · 11 subscriptions & admin access
-- Entitlements live in ONE table (plan §2: RevenueCat slots in later by writing
-- here from its webhook). Tier → feature mapping is code (packages/shared and
-- apps/web/lib/entitlements.ts); the DB stores only who has which tier.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  tier text not null default 'free'
    check (tier in ('free', 'premium', 'coach_free', 'coach_pro')),
  status text not null default 'active'
    check (status in ('active', 'canceled', 'past_due')),
  provider text not null default 'manual', -- 'revenuecat' once payments land (V2)
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated before update on public.subscriptions
  for each row execute function public.handle_updated_at();

-- every profile starts on the free tier
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_profile_created
  after insert on public.users
  for each row execute function public.handle_new_profile();

-- backfill existing users
insert into public.subscriptions (user_id)
select id from public.users
on conflict (user_id) do nothing;

-- ---------- admin helper ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- RLS ----------
alter table public.subscriptions enable row level security;

-- users read their own tier; admins read all. Writes: service role only
-- (payment webhook / admin tooling) — deliberately no insert/update policies.
create policy subscriptions_read on public.subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- admin oversight (read + role management); moderation tooling comes with V1.2
create policy users_admin_read on public.users for select to authenticated
  using (public.is_admin());
create policy users_admin_update on public.users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy tc_admin_read on public.trainer_clients for select to authenticated
  using (public.is_admin());
create policy adherence_admin_read on public.adherence_snapshots for select to authenticated
  using (public.is_admin());

-- ---------- tier-gated invite limit (server-enforced, not just UI) ----------
-- coach_free: 3 client slots · coach_pro: 30. Raises CLIENT_LIMIT_REACHED.
create or replace function public.create_invite()
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(encode(gen_random_bytes(4), 'hex'));
  v_row public.trainer_clients;
  v_tier text;
  v_limit int;
  v_used int;
begin
  select tier into v_tier from public.subscriptions
  where user_id = auth.uid() and status = 'active';
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
