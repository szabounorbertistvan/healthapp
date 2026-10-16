import "server-only";
import { cache } from "react";
import { entitlementsFor, historyStart, isCoachTier, planEntitlements, TIER_LABEL, todayIn, type Entitlements, type Tier } from "@healthapp/shared";
import { getProfile } from "./data";
import type { Upgrade } from "./plan-client";

/**
 * What the signed-in person's plan lets them do, for gating a screen or an
 * action. Everything comes off getProfile (request-cached, already read by
 * the layout), so asking costs no round trip.
 *
 * With the paywall off — the default until billing goes live — `e` is the
 * role's full paid set, so every gate below is open.
 */
export type Plan = {
  tier: Tier;
  paywall: boolean;
  /** Premium only because the person's active coach pays for Coach Pro. */
  viaCoach: boolean;
  e: Entitlements;
  /** First local day history lists show, or null for all of it. */
  historySince: string | null;
  /** Where "See plans" goes and the plan it names: Coach Pro for anyone who coaches, Premium otherwise. */
  upgrade: Upgrade;
  /**
   * What this person will have once the paywall is on, if they do not pay —
   * the role's free set — while that is less than what they have now; null
   * when nothing will change (the paywall already applies, they pay, or a
   * Coach Pro covers them). Drives the "Premium · free for now" tags.
   */
  later: Entitlements | null;
  /** The "Try … free for 30 days" button may show (start_trial() would accept). */
  trialAvailable: boolean;
};

export type { Upgrade };

export const getPlan = cache(async (): Promise<Plan> => {
  const profile = await getProfile();
  const tier = profile?.tier ?? "free";
  const paywall = profile?.paywall ?? false;
  const e = planEntitlements(tier, paywall);
  const viaCoach = profile?.tier_via_coach ?? false;
  // A paid tier with no trial running is a subscription (or a comp); a paid
  // tier inside the trial is the trial, which ends.
  const trialRunning = profile?.trial_ends_at ? new Date(profile.trial_ends_at).getTime() > Date.now() : false;
  const paid = (tier === "premium" || tier === "coach_pro") && !trialRunning;
  const later = paywall || paid || viaCoach ? null : entitlementsFor(isCoachTier(tier) ? "coach_free" : "free");
  return {
    tier,
    paywall,
    viaCoach,
    later,
    trialAvailable: profile?.trial_available ?? false,
    e,
    historySince: historyStart(e, todayIn(profile?.timezone ?? "Europe/Bucharest")),
    upgrade: isCoachTier(tier)
      ? { href: "/settings", label: TIER_LABEL.coach_pro }
      : { href: "/billing", label: TIER_LABEL.premium },
  };
});

/** True when an ISO day or timestamp falls inside the plan's history window. */
export function inHistory(plan: Pick<Plan, "historySince">, at: string | null | undefined): boolean {
  if (!plan.historySince || !at) return true;
  return at.slice(0, 10) >= plan.historySince;
}
