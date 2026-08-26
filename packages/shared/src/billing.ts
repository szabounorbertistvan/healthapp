// Billing rules shared by web, the stripe-webhook edge function and (later)
// mobile. Price AMOUNTS live in Stripe (source of truth, changeable without a
// deploy); the numbers here are display defaults for the MVP. What connects
// the two is the price lookup_key — scripts/stripe-setup.mjs creates the
// Stripe prices with these keys, checkout resolves them, and the webhook maps
// them back to a tier.
import type { Role, Tier } from "./entitlements";

export type PaidTier = "premium" | "coach_pro";
export type PlanInterval = "monthly" | "annual";

export const TRIAL_DAYS = 30;
export const ANNUAL_DISCOUNT = 0.15; // annual = 12 × monthly − 15%

/** MVP display prices (EUR). Real amounts are whatever the Stripe price says. */
export const PLAN_PRICES: Record<PaidTier, { monthly: number; annual: number; currency: string }> = {
  premium: { monthly: 10, annual: 102, currency: "EUR" },
  coach_pro: { monthly: 10, annual: 102, currency: "EUR" },
};

export function annualFromMonthly(monthly: number): number {
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT));
}

export const PRICE_LOOKUP_KEYS: Record<PaidTier, Record<PlanInterval, string>> = {
  premium: { monthly: "premium_monthly", annual: "premium_annual" },
  coach_pro: { monthly: "coach_pro_monthly", annual: "coach_pro_annual" },
};

/** Reverse of PRICE_LOOKUP_KEYS — used by the webhook. */
export function tierForLookupKey(key: string | null | undefined): PaidTier | null {
  if (!key) return null;
  for (const tier of Object.keys(PRICE_LOOKUP_KEYS) as PaidTier[]) {
    if (key === PRICE_LOOKUP_KEYS[tier].monthly || key === PRICE_LOOKUP_KEYS[tier].annual) return tier;
  }
  return null;
}

/** The paid tier a role gets while trialing (full features, no card). */
export function trialTierFor(role: Role): PaidTier {
  return role === "client" ? "premium" : "coach_pro";
}

export type SubscriptionRow = {
  tier: Tier;
  status: string; // active | canceled | past_due
  trial_ends_at?: string | null;
};

/**
 * What the user is actually entitled to right now. Mirrors public.effective_tier
 * in SQL (migration 13): a paid/granted tier wins; otherwise an unexpired
 * trial grants the full paid tier for the role; otherwise free.
 */
export function effectiveTier(sub: SubscriptionRow | null | undefined, role: Role, now = new Date()): Tier {
  if (sub && sub.status === "active" && sub.tier !== "free") return sub.tier;
  if (sub?.trial_ends_at && new Date(sub.trial_ends_at) > now) return trialTierFor(role);
  return "free";
}

/** Whole days of trial left, never negative. Null when no trial was recorded. */
export function trialDaysLeft(trialEndsAt: string | null | undefined, now = new Date()): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
