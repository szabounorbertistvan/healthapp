// Tier → feature mapping. The DB stores only the tier (subscriptions table);
// what each tier unlocks is defined here, in one place. The numeric limits are
// enforced a second time in SQL — `plan_limit()` in migration
// 20260923120000_paywall.sql mirrors LIMITS below, and create_invite mirrors
// maxClients — so if the two drift, the UI offers what the server refuses.
//
// None of this bites until the paywall switch is on (`app_flags.paywall`, read
// per user through the `my_plan` view). While it is off, planEntitlements()
// answers the role's full paid set and only the coach roster cap — which
// create_invite has enforced since before the paywall existed — still applies.
export type Tier = "free" | "premium" | "coach_free" | "coach_pro";
export type Role = "client" | "coach" | "both" | "admin";

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  premium: "Premium",
  coach_free: "Coach Starter",
  coach_pro: "Coach Pro",
};

/** `null` in a limit means unlimited. */
export type Entitlements = {
  // ---- training & progress (every role trains: a coach's own "My training" too) ----
  /** How far back the person's own history lists reach (sessions, weigh-ins, food diary, photos). */
  historyDays: number | null;
  /** Weight / waist / weekly-volume charts, the full PR list, the fitness-score trend and breakdown. */
  progressCharts: boolean;
  /** Two progress photos side by side. Uploading stays free. */
  photoCompare: boolean;
  /** Edit Stats, the square format and hiding the profile on a share card. */
  shareCustomize: boolean;
  /** Own programs built in the solo builder (coach_id null). */
  maxOwnPrograms: number | null;
  /** Custom exercises in the person's own library. */
  maxCustomExercises: number | null;
  /** Setting your own YouTube demo on an exercise. Watching your coach's is always free. */
  customExerciseVideos: boolean;
  // ---- nutrition ----
  barcodeScansPerDay: number | null;
  maxFavoriteFoods: number | null;
  // ---- coaching ----
  maxClients: number;
  /** Adherence signal, reason and % on the dashboard; a client's fitness score on their page. */
  advancedAnalytics: boolean;
  /** Duplicate a program day; copy a whole program to another client. */
  programCopy: boolean;
  /** Filling a meal plan with real foods and grams. Without it a plan is its four macro targets. */
  ingredientPlans: boolean;
};

const CLIENT_FREE = {
  historyDays: 30,
  progressCharts: false,
  photoCompare: false,
  shareCustomize: false,
  maxOwnPrograms: 1,
  maxCustomExercises: 3,
  customExerciseVideos: false,
  barcodeScansPerDay: 5,
  maxFavoriteFoods: 10,
} as const;

const CLIENT_PREMIUM = {
  historyDays: null,
  progressCharts: true,
  photoCompare: true,
  shareCustomize: true,
  maxOwnPrograms: null,
  maxCustomExercises: null,
  customExerciseVideos: true,
  barcodeScansPerDay: null,
  maxFavoriteFoods: null,
} as const;

const NO_COACHING = { maxClients: 0, advancedAnalytics: false, programCopy: false, ingredientPlans: false } as const;

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: { ...CLIENT_FREE, ...NO_COACHING },
  premium: { ...CLIENT_PREMIUM, ...NO_COACHING },
  // A Starter coach trains on the free set: were it more, "coach" would be a
  // free way to Premium for anyone willing to tick that box at sign-up.
  coach_free: {
    ...CLIENT_FREE,
    maxCustomExercises: 10,
    maxClients: 3,
    advancedAnalytics: false,
    programCopy: false,
    ingredientPlans: false,
  },
  coach_pro: {
    ...CLIENT_PREMIUM,
    maxClients: 30,
    advancedAnalytics: true,
    programCopy: true,
    ingredientPlans: true,
  },
};

export function entitlementsFor(tier: Tier): Entitlements {
  return ENTITLEMENTS[tier] ?? ENTITLEMENTS.free;
}

export function isCoachTier(tier: Tier): boolean {
  return tier === "coach_free" || tier === "coach_pro";
}

/**
 * What the person can actually use right now. With the paywall off every
 * feature is on — the role's full paid set — and only the roster cap follows
 * the real tier, exactly as create_invite always has.
 */
export function planEntitlements(tier: Tier, paywall: boolean): Entitlements {
  const own = entitlementsFor(tier);
  if (paywall) return own;
  const full = isCoachTier(tier) ? ENTITLEMENTS.coach_pro : ENTITLEMENTS.premium;
  return { ...full, maxClients: own.maxClients };
}

/** The limits SQL enforces, by the feature key `plan_limit()` takes. */
export type PlanLimitKey = "own_programs" | "custom_exercises" | "favorite_foods" | "barcode_scans_day";

export function planLimit(e: Entitlements, key: PlanLimitKey): number | null {
  switch (key) {
    case "own_programs":
      return e.maxOwnPrograms;
    case "custom_exercises":
      return e.maxCustomExercises;
    case "favorite_foods":
      return e.maxFavoriteFoods;
    case "barcode_scans_day":
      return e.barcodeScansPerDay;
  }
}

/** True when `used` has reached a limit (`null` never does). */
export function atLimit(limit: number | null, used: number): boolean {
  return limit !== null && used >= limit;
}

/** The error text SQL raises when a write would pass a plan limit. */
export const PLAN_LIMIT_REACHED = "PLAN_LIMIT_REACHED";

/** Recognises PLAN_LIMIT_REACHED in a PostgREST error message. */
export function isPlanLimitError(message: string | null | undefined): boolean {
  return Boolean(message && message.includes(PLAN_LIMIT_REACHED));
}

/** First ISO day (YYYY-MM-DD) a history window still shows, or null when unlimited. */
export function historyStart(e: Pick<Entitlements, "historyDays">, today: string): string | null {
  if (e.historyDays === null) return null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (e.historyDays - 1));
  return d.toISOString().slice(0, 10);
}
