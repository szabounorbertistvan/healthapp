// Achievements, Fitness Score milestones and profile privacy — the rules the
// database enforces in 20260930120000_social_v2_completion.sql, mirrored so
// the app and SQL cannot disagree about who earned what or who may see it.
//
//   award_badges_for()     ⇄ earnedBadges()
//   longest_workout_streak ⇄ longestRun()
//   social_posts_guard     ⇄ fitnessScorePostPayload() / FITNESS_SCORE_MILESTONES
//   can_see_stats()        ⇄ canSeeStats()
//   can_see_fitness_score  ⇄ canSeeFitnessScore()
//
// Nothing here reads anybody's data; it decides from numbers it is handed.

import { relevantOneRm } from "./exercise-analytics";

export type ProfileVisibility = "public" | "followers" | "private";
export const PROFILE_VISIBILITIES: readonly ProfileVisibility[] = ["public", "followers", "private"];

export function isProfileVisibility(x: unknown): x is ProfileVisibility {
  return typeof x === "string" && (PROFILE_VISIBILITIES as readonly string[]).includes(x);
}

// ---------- badges ----------
//
// Since 20261002100000_advanced_achievements.sql every badge row carries its
// own rule (metric + target) and award_badges_for() compares
// achievement_facts() against it. ACHIEVEMENT_CATALOG is the mirror of those
// rows; advanced_achievements.test.sql pins the SQL side to the same targets.

/** The facts achievement_facts() can compute. Keys are the SQL names. */
export const ACHIEVEMENT_METRICS = [
  "workouts",
  "longest_streak",
  "prs",
  "checkins",
  "challenges",
  "longest_food_run",
  "volume_kg",
  "active_days",
  "nutrition_days",
  "bench_kg",
  "squat_kg",
  "deadlift_kg",
  "e1rm_total_kg",
] as const;
export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];

export function isAchievementMetric(x: unknown): x is AchievementMetric {
  return typeof x === "string" && (ACHIEVEMENT_METRICS as readonly string[]).includes(x);
}

/** Display order of the filter. Only categories some badge uses exist. */
export const ACHIEVEMENT_CATEGORIES = [
  "strength", "workouts", "consistency", "volume", "nutrition", "challenges", "progress",
] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export function isAchievementCategory(x: unknown): x is AchievementCategory {
  return typeof x === "string" && (ACHIEVEMENT_CATEGORIES as readonly string[]).includes(x);
}

/** A property of the badge, fixed in the catalog — never a ranking of people. */
export const ACHIEVEMENT_RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

export function isAchievementRarity(x: unknown): x is AchievementRarity {
  return typeof x === "string" && (ACHIEVEMENT_RARITIES as readonly string[]).includes(x);
}

/** standard | advanced — metadata for the future Premium split; nothing reads it for access. */
export type AchievementKind = "standard" | "advanced";

/** What a metric counts in, for "73 / 100 workouts". */
export type AchievementUnit = "workouts" | "days" | "prs" | "check_ins" | "challenges" | "kg";

const METRIC_UNIT: Record<AchievementMetric, AchievementUnit> = {
  workouts: "workouts",
  longest_streak: "days",
  prs: "prs",
  checkins: "check_ins",
  challenges: "challenges",
  longest_food_run: "days",
  volume_kg: "kg",
  active_days: "days",
  nutrition_days: "days",
  bench_kg: "kg",
  squat_kg: "kg",
  deadlift_kg: "kg",
  e1rm_total_kg: "kg",
};

export function metricUnit(metric: AchievementMetric): AchievementUnit {
  return METRIC_UNIT[metric];
}

export type AchievementDef = {
  slug: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  kind: AchievementKind;
  metric: AchievementMetric;
  target: number;
};

const def = (
  slug: string, category: AchievementCategory, rarity: AchievementRarity,
  kind: AchievementKind, metric: AchievementMetric, target: number,
): AchievementDef => ({ slug, category, rarity, kind, metric, target });

/** The catalog, in badges.sort order. Slugs are the stable key. */
export const ACHIEVEMENT_CATALOG = [
  def("first-workout", "workouts", "common", "standard", "workouts", 1),
  def("workouts-10", "workouts", "common", "standard", "workouts", 10),
  def("workouts-50", "workouts", "rare", "standard", "workouts", 50),
  def("streak-7", "consistency", "common", "standard", "longest_streak", 7),
  def("streak-30", "consistency", "rare", "standard", "longest_streak", 30),
  def("first-checkin", "progress", "common", "standard", "checkins", 1),
  def("first-pr", "strength", "common", "standard", "prs", 1),
  def("nutrition-week", "nutrition", "common", "standard", "longest_food_run", 7),
  def("workouts-100", "workouts", "rare", "standard", "workouts", 100),
  def("streak-100", "consistency", "epic", "standard", "longest_streak", 100),
  def("prs-10", "strength", "common", "standard", "prs", 10),
  def("first-challenge", "challenges", "common", "standard", "challenges", 1),
  def("workouts-250", "workouts", "epic", "advanced", "workouts", 250),
  def("workouts-500", "workouts", "epic", "advanced", "workouts", 500),
  def("workouts-1000", "workouts", "legendary", "advanced", "workouts", 1000),
  def("volume-100k", "volume", "rare", "advanced", "volume_kg", 100_000),
  def("volume-500k", "volume", "epic", "advanced", "volume_kg", 500_000),
  def("volume-1m", "volume", "legendary", "advanced", "volume_kg", 1_000_000),
  def("active-days-30", "consistency", "common", "advanced", "active_days", 30),
  def("active-days-90", "consistency", "rare", "advanced", "active_days", 90),
  def("active-days-180", "consistency", "epic", "advanced", "active_days", 180),
  def("active-days-365", "consistency", "legendary", "advanced", "active_days", 365),
  def("prs-25", "strength", "rare", "advanced", "prs", 25),
  def("prs-50", "strength", "epic", "advanced", "prs", 50),
  def("prs-100", "strength", "legendary", "advanced", "prs", 100),
  def("bench-100", "strength", "epic", "advanced", "bench_kg", 100),
  def("squat-140", "strength", "epic", "advanced", "squat_kg", 140),
  def("deadlift-180", "strength", "epic", "advanced", "deadlift_kg", 180),
  def("e1rm-total-1000", "strength", "legendary", "advanced", "e1rm_total_kg", 1000),
  def("nutrition-days-30", "nutrition", "rare", "advanced", "nutrition_days", 30),
  def("nutrition-days-100", "nutrition", "epic", "advanced", "nutrition_days", 100),
  def("challenges-5", "challenges", "rare", "advanced", "challenges", 5),
  def("challenges-10", "challenges", "epic", "advanced", "challenges", 10),
  def("challenges-25", "challenges", "legendary", "advanced", "challenges", 25),
] as const satisfies readonly AchievementDef[];

export const BADGE_SLUGS = ACHIEVEMENT_CATALOG.map((d) => d.slug) as readonly string[];
export type BadgeSlug = string;

export function isBadgeSlug(x: unknown): x is BadgeSlug {
  return typeof x === "string" && BADGE_SLUGS.includes(x);
}

export function achievementDef(slug: string): AchievementDef | null {
  return ACHIEVEMENT_CATALOG.find((d) => d.slug === slug) ?? null;
}

/** achievement_facts() as a value. A missing key is "not computed", read as 0. */
export type AchievementFacts = Partial<Record<AchievementMetric, number>>;

/** The counts the original twelve badges read — kept for callers of that shape. */
export type BadgeFacts = {
  /** Completed logged_sessions. */
  workouts: number;
  /** Longest run of consecutive local days with a completed workout. */
  longestStreak: number;
  /** logged_sets flagged is_pr. */
  prs: number;
  checkins: number;
  challengesCompleted: number;
  /** Longest run of consecutive days with at least one food log. */
  longestFoodRun: number;
};

function toFacts(f: BadgeFacts | AchievementFacts): AchievementFacts {
  if ("longestStreak" in f || "challengesCompleted" in f || "longestFoodRun" in f) {
    const b = f as BadgeFacts;
    return {
      workouts: b.workouts, longest_streak: b.longestStreak, prs: b.prs, checkins: b.checkins,
      challenges: b.challengesCompleted, longest_food_run: b.longestFoodRun,
    };
  }
  return f as AchievementFacts;
}

/** award_badges_from_facts(): may this badge be awarded on these facts? */
export function isEligible(d: Pick<AchievementDef, "metric" | "target">, facts: AchievementFacts, active = true): boolean {
  if (!active) return false;
  const v = facts[d.metric];
  return typeof v === "number" && Number.isFinite(v) && v >= d.target;
}

/** Every badge these facts earn, in catalog order. */
export function earnedBadges(facts: BadgeFacts | AchievementFacts): BadgeSlug[] {
  const f = toFacts(facts);
  return ACHIEVEMENT_CATALOG.filter((d) => isEligible(d, f)).map((d) => d.slug);
}

/** Badges earned but not yet held — what the next award run would insert. */
export function newBadges(facts: BadgeFacts | AchievementFacts, held: Iterable<string>): BadgeSlug[] {
  const have = new Set(held);
  return earnedBadges(facts).filter((slug) => !have.has(slug));
}

// ---------- progress ----------

export type AchievementProgress = {
  current: number;
  target: number;
  /** Whole percent, 0..100, rounded DOWN: 99.6% is not "100%" until it is earned. */
  percent: number;
  remaining: number;
  complete: boolean;
};

/**
 * current / target as the card shows it. Non-numbers and negatives read as 0;
 * a non-positive target is treated as already met, so it never divides by 0.
 */
export function achievementProgress(current: number, target: number): AchievementProgress {
  const cur = Number.isFinite(current) && current > 0 ? current : 0;
  if (!Number.isFinite(target) || target <= 0) {
    return { current: cur, target: 0, percent: 100, remaining: 0, complete: true };
  }
  const complete = cur >= target;
  return {
    current: cur,
    target,
    percent: complete ? 100 : Math.min(99, Math.floor((cur / target) * 100)),
    remaining: complete ? 0 : target - cur,
    complete,
  };
}

/** Categories some badge in this list uses, in display order — the filter shows only these. */
export function categoriesPresent(badges: readonly { category: string }[]): AchievementCategory[] {
  const used = new Set(badges.map((b) => b.category));
  return ACHIEVEMENT_CATEGORIES.filter((c) => used.has(c));
}

export type AchievementSummary = {
  earned: number;
  total: number;
  byCategory: { category: AchievementCategory; earned: number; total: number }[];
  byRarity: { rarity: AchievementRarity; earned: number }[];
};

/** Totals for a shelf: how many earned, per category and per rarity. */
export function summarizeAchievements(
  badges: readonly { category: string; rarity: string; earned: boolean }[],
): AchievementSummary {
  return {
    earned: badges.filter((b) => b.earned).length,
    total: badges.length,
    byCategory: categoriesPresent(badges).map((category) => {
      const inCat = badges.filter((b) => b.category === category);
      return { category, earned: inCat.filter((b) => b.earned).length, total: inCat.length };
    }),
    byRarity: ACHIEVEMENT_RARITIES.map((rarity) => ({
      rarity,
      earned: badges.filter((b) => b.earned && b.rarity === rarity).length,
    })).filter((r) => r.earned > 0),
  };
}

// ---------- strength facts ----------

/** The Free Exercise DB rows each lift milestone reads (system library rows only). */
export const CANONICAL_LIFTS = {
  bench: ["Barbell_Bench_Press_-_Medium_Grip", "Bench_Press_-_Powerlifting"],
  squat: ["Barbell_Squat", "Barbell_Full_Squat"],
  deadlift: ["Barbell_Deadlift"],
} as const;
export type CanonicalLift = keyof typeof CANONICAL_LIFTS;

export type LiftSet = { lift: CanonicalLift; weight_kg: number; reps: number; completed: boolean };

/**
 * The strength facts achievement_facts() computes, from sets already matched
 * to a canonical lift:
 *   · <lift>_kg — the heaviest weight lifted for at least one rep (never an estimate);
 *   · e1rm_total_kg — Σ of each lift's best relevantOneRm(), the estimate the
 *     exercise page uses, rounded to 0.01 like the SQL.
 * Sets from unfinished sessions do not count.
 */
export function strengthFacts(sets: readonly LiftSet[]): Pick<AchievementFacts, "bench_kg" | "squat_kg" | "deadlift_kg" | "e1rm_total_kg"> {
  const top: Record<CanonicalLift, number> = { bench: 0, squat: 0, deadlift: 0 };
  const best1rm: Record<CanonicalLift, number> = { bench: 0, squat: 0, deadlift: 0 };
  for (const s of sets) {
    if (!s.completed || !(s.weight_kg > 0) || !(s.reps >= 1)) continue;
    top[s.lift] = Math.max(top[s.lift], s.weight_kg);
    const e = relevantOneRm(s.weight_kg, s.reps);
    if (e !== null) best1rm[s.lift] = Math.max(best1rm[s.lift], e);
  }
  const total = best1rm.bench + best1rm.squat + best1rm.deadlift;
  return {
    bench_kg: top.bench,
    squat_kg: top.squat,
    deadlift_kg: top.deadlift,
    e1rm_total_kg: Math.round(total * 100) / 100,
  };
}

/**
 * The longest run of consecutive calendar days in a list of "YYYY-MM-DD"
 * strings — gaps and islands, the same as the SQL. Duplicates and order do not
 * matter; malformed entries are ignored.
 */
export function longestRun(days: readonly string[]): number {
  const stamps = [...new Set(days)]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .map((d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const t of stamps) {
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

// ---------- Fitness Score milestones ----------

/** The only milestones social_posts_guard accepts. */
export const FITNESS_SCORE_MILESTONES = [25, 50, 60, 70, 80, 90, 100] as const;
export type FitnessScoreMilestone = (typeof FITNESS_SCORE_MILESTONES)[number];

/** The highest milestone at or under a score; null below the first one. */
export function fitnessScoreMilestone(score: number): FitnessScoreMilestone | null {
  if (!Number.isFinite(score)) return null;
  let hit: FitnessScoreMilestone | null = null;
  for (const m of FITNESS_SCORE_MILESTONES) if (score >= m) hit = m;
  return hit;
}

export type FitnessScorePostPayload = {
  kind: "fitness_score";
  score: number;
  milestone: FitnessScoreMilestone;
  band: string | null;
};

/**
 * The snapshot a Fitness Score post carries: a whole number, the milestone it
 * reached, and the band label — never the sessions or volume behind it. Null
 * when there is nothing to share yet (below 25, or not a number).
 */
export function fitnessScorePostPayload(score: number, band: string | null = null): FitnessScorePostPayload | null {
  if (!Number.isFinite(score)) return null;
  const whole = Math.min(100, Math.max(0, Math.round(score)));
  const milestone = fitnessScoreMilestone(whole);
  if (milestone === null) return null;
  return { kind: "fitness_score", score: whole, milestone, band: typeof band === "string" && band.length <= 40 ? band : null };
}

export type AchievementPostPayload = {
  kind: "achievement";
  badge_slug: string;
  /** Filled in by the database from the catalog — the browser sends only the slug. */
  name_en?: string;
  name_ro?: string;
  icon?: string | null;
  awarded_at?: string;
  /** Frozen at share time since 20261002100000; absent on older posts. */
  category?: string;
  rarity?: string;
  metric?: string;
  target?: number;
};

// ---------- who may see a profile's numbers ----------

export type Relationship = {
  /** The viewer follows the subject. */
  follows: boolean;
  /** The viewer is the subject's active coach. */
  coach?: boolean;
  admin?: boolean;
};

/** can_see_stats(): yourself, the setting, then coach and admin who see more already. */
export function canSeeStats(
  subject: { id: string; stats_visibility: ProfileVisibility },
  viewerId: string,
  rel: Relationship,
): boolean {
  if (subject.id === viewerId) return true;
  if (subject.stats_visibility === "public") return true;
  if (subject.stats_visibility === "followers" && rel.follows) return true;
  return Boolean(rel.coach || rel.admin);
}

/**
 * can_see_fitness_score(): opt-in. Unlike the stats, a coach gets no special
 * path here — they already see the live score on the client's page, and the
 * published snapshot is what the person chose to show the world.
 */
export function canSeeFitnessScore(
  subject: { id: string; fitness_score_visibility: ProfileVisibility },
  viewerId: string,
  rel: Pick<Relationship, "follows">,
): boolean {
  if (subject.id === viewerId) return true;
  if (subject.fitness_score_visibility === "public") return true;
  return subject.fitness_score_visibility === "followers" && rel.follows;
}

/** How two people relate, for the profile's chip. */
export type FollowState = "self" | "mutual" | "following" | "follows_you" | "none";

export function followState(p: { me: boolean; is_following: boolean; follows_me: boolean }): FollowState {
  if (p.me) return "self";
  if (p.is_following && p.follows_me) return "mutual";
  if (p.is_following) return "following";
  if (p.follows_me) return "follows_you";
  return "none";
}
