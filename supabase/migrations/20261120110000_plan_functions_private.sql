-- Plan functions: answer only about the caller (2026-11-20)
--
-- Found by the privilege audit of 2026-10-12: own_tier(uid), effective_tier(uid),
-- paywall_on(uid) and user_plan_limit(uid, key) (20260923120000) are SECURITY
-- DEFINER and were executable by anyone — anon included, through PUBLIC — for
-- ANY user id. Given a user's id they told whether the account exists, its role
-- and paid tier, whether it is a preview user, and (effective_tier) whether a
-- free client has an active Coach Pro coach: a coaching relationship.
--
-- Nothing in the app calls them directly. Their callers are SECURITY DEFINER
-- functions (create_invite, claim_barcode_scan, the enforce_plan_limit trigger)
-- and the my_plan view, which the signed-in user reads for their own plan. So:
--   1. my_plan reads through my_plan_row(), a SECURITY DEFINER function keyed to
--      auth.uid() — same columns, same rows (the caller's own, nothing else);
--   2. the four functions are no longer executable by PUBLIC, anon or
--      authenticated; definer functions and the trigger keep working;
--   3. program_usage(program) (20260930100000) — counts for a program the
--      caller can see — no longer answers without a session.

create or replace function public.my_plan_row()
returns table (user_id uuid, tier text, own_tier text, paywall boolean, status text, trial_ends_at timestamptz, has_stripe boolean)
language sql stable security definer set search_path = public as $$
  select u.id, public.effective_tier(u.id), public.own_tier(u.id), public.paywall_on(u.id),
         s.status, s.trial_ends_at, (s.stripe_customer_id is not null)
  from public.users u
  left join public.subscriptions s on s.user_id = u.id
  where u.id = auth.uid();
$$;
revoke execute on function public.my_plan_row() from public, anon;
grant execute on function public.my_plan_row() to authenticated;

create or replace view public.my_plan with (security_invoker = false) as
select p.user_id, p.tier, p.own_tier, p.paywall, p.status, p.trial_ends_at, p.has_stripe
from public.my_plan_row() p;
revoke all on public.my_plan from anon, authenticated;
grant select on public.my_plan to authenticated;

revoke execute on function public.own_tier(uuid) from public, anon, authenticated;
revoke execute on function public.effective_tier(uuid) from public, anon, authenticated;
revoke execute on function public.paywall_on(uuid) from public, anon, authenticated;
revoke execute on function public.user_plan_limit(uuid, text) from public, anon, authenticated;

revoke execute on function public.program_usage(uuid) from public, anon;
grant execute on function public.program_usage(uuid) to authenticated;
