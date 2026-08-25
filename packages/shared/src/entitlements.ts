// Tier → feature mapping. The DB stores only the tier (subscriptions table);
// what each tier unlocks is defined here, in one place, mirrored server-side
// where enforcement matters (e.g. create_invite's client limit).
export type Tier = "free" | "premium" | "coach_free" | "coach_pro";
export type Role = "client" | "coach" | "both" | "admin";

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  premium: "Premium",
  coach_free: "Coach Starter",
  coach_pro: "Coach Pro",
};

export type Entitlements = {
  // client features
  progressCharts: boolean;
  progressPhotos: boolean;
  habitsAndStreaks: boolean;
  // coach features
  maxClients: number;
  advancedAnalytics: boolean;
  customExerciseVideos: boolean;
};

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
  free: {
    progressCharts: true,
    progressPhotos: false,
    habitsAndStreaks: true,
    maxClients: 0,
    advancedAnalytics: false,
    customExerciseVideos: false,
  },
  premium: {
    progressCharts: true,
    progressPhotos: true,
    habitsAndStreaks: true,
    maxClients: 0,
    advancedAnalytics: false,
    customExerciseVideos: false,
  },
  coach_free: {
    progressCharts: true,
    progressPhotos: true,
    habitsAndStreaks: true,
    maxClients: 3,
    advancedAnalytics: false,
    customExerciseVideos: false,
  },
  coach_pro: {
    progressCharts: true,
    progressPhotos: true,
    habitsAndStreaks: true,
    maxClients: 30,
    advancedAnalytics: true,
    customExerciseVideos: true,
  },
};

export function entitlementsFor(tier: Tier): Entitlements {
  return ENTITLEMENTS[tier] ?? ENTITLEMENTS.free;
}
