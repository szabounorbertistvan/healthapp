-- The 30-day trial starts when the person asks for it (2026-11-29)
--
-- Product decision (relu, 2026-10-16): everything is free until Premium goes
-- live. From then on nobody has paid features by default; a "Try Premium
-- free for 30 days" button starts the trial — once per account, no card.
--
-- Until now the trial was stamped at sign-up (20260826090000: trial_ends_at =
-- sign-up + 30 days) and own_tier() honoured it on its own. With the paywall
-- off for months, every such trial would run out unused, and a trial nobody
-- chose is not one they notice. So:
--
--   subscriptions.trial_started_at   when the person pressed the button; NULL = never
--   own_tier()                       a trial counts only once started (and until trial_ends_at)
--   start_trial()                    the one door: paywall on for the caller, not
--                                    already paid or covered by a Coach Pro, never
--                                    started before → now() .. now() + 30 days
--   handle_new_profile()             no longer stamps a trial at sign-up
--   my_plan                          trial_ends_at only for a started trial, plus
--                                    trial_available (the button's condition)
--
-- No row is updated: the sign-up trial_ends_at values already stored simply
-- stop counting (trial_started_at is NULL on all of them). A paid
-- subscription and Premium through a Coach Pro work exactly as before.
-- Mirrored in packages/shared/src/billing.ts effectiveTier().

alter table public.subscriptions
  add column if not exists trial_started_at timestamptz;

comment on column public.subscriptions.trial_started_at is
  'When the person started their one 30-day trial (start_trial()). NULL = never; a trial_ends_at without it does not count.';

-- every profile starts on the free tier, with no trial running
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Same body as 20260923120000, the trial now counted only once started.
create or replace function public.own_tier(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when s.status = 'active' and s.tier <> 'free' then s.tier
    when s.trial_started_at is not null and s.trial_ends_at > now() then
      case when u.role in ('coach', 'both', 'admin') then 'coach_pro' else 'premium' end
    when u.role in ('coach', 'both', 'admin') then 'coach_free'
    else 'free'
  end
  from public.users u
  left join public.subscriptions s on s.user_id = u.id
  where u.id = uid;
$$;

-- Whether the caller may start a trial now: the paywall applies to them, they
-- are on a free tier (not paying, not covered by a Coach Pro), never trialled.
create or replace function public.trial_available(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.paywall_on(uid)
     and public.effective_tier(uid) in ('free', 'coach_free')
     and coalesce((select s.trial_started_at is null from public.subscriptions s where s.user_id = uid), true);
$$;
revoke execute on function public.trial_available(uuid) from public, anon, authenticated;

create or replace function public.start_trial()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ends timestamptz := now() + interval '30 days';
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not public.paywall_on(v_uid) then
    raise exception 'TRIAL_NOT_OPEN' using errcode = '22023';   -- everything is free anyway
  end if;
  if public.effective_tier(v_uid) not in ('free', 'coach_free') then
    raise exception 'TRIAL_NOT_NEEDED' using errcode = '22023'; -- paying, or a Coach Pro covers them
  end if;
  insert into public.subscriptions (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.subscriptions
     set trial_started_at = now(), trial_ends_at = v_ends
   where user_id = v_uid and trial_started_at is null;
  if not found then
    raise exception 'TRIAL_USED' using errcode = '22023';
  end if;
  return v_ends;
end;
$$;
revoke execute on function public.start_trial() from public, anon;
grant execute on function public.start_trial() to authenticated;

-- my_plan gains a column, so the function and the view are recreated (same grants as 20261120110000).
drop view if exists public.my_plan;
drop function if exists public.my_plan_row();

create function public.my_plan_row()
returns table (user_id uuid, tier text, own_tier text, paywall boolean, status text, trial_ends_at timestamptz, has_stripe boolean, trial_available boolean)
language sql stable security definer set search_path = public as $$
  select u.id, public.effective_tier(u.id), public.own_tier(u.id), public.paywall_on(u.id),
         s.status,
         case when s.trial_started_at is not null then s.trial_ends_at end,
         (s.stripe_customer_id is not null),
         public.trial_available(u.id)
  from public.users u
  left join public.subscriptions s on s.user_id = u.id
  where u.id = auth.uid();
$$;
revoke execute on function public.my_plan_row() from public, anon;
grant execute on function public.my_plan_row() to authenticated;

create view public.my_plan with (security_invoker = false) as
select p.user_id, p.tier, p.own_tier, p.paywall, p.status, p.trial_ends_at, p.has_stripe, p.trial_available
from public.my_plan_row() p;
revoke all on public.my_plan from anon, authenticated;
grant select on public.my_plan to authenticated;
