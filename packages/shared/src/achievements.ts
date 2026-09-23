// Achievements, Fitness Score milestones and profile privacy — the rules the
// database enforces in 20260925100000_social_v2_completion.sql, mirrored so
// the app and SQL cannot disagree about who earned what or who may see it.
//
//   award_badges_for()     ⇄ earnedBadges()
//   longest_workout_streak ⇄ longestRun()
//   social_posts_guard     ⇄ fitnessScorePostPayload() / FITNESS_SCORE_MILESTONES
//   can_see_stats()        ⇄ canSeeStats()
//   can_see_fitness_score  ⇄ canSeeFitnessScore()
//
// Nothing here reads anybody's data; it decides from numbers it is handed.

export type ProfileVisibility = "public" | "followers" | "private";
export const PROFILE_VISIBILITIES: readonly ProfileVisibility[] = ["public", "followers", "private"];

export function isProfileVisibility(x: unknown): x is ProfileVisibility {
  return typeof x === "string" && (PROFILE_VISIBILITIES as readonly string[]).includes(x);
}

// ---------- badges ----------

/** The catalog, in the order the SQL checks it. Slugs are the stable key. */
export const BADGE_SLUGS = [
  "first-workout",
  "workouts-10",
  "workouts-50",
  "workouts-100",
  "streak-7",
  "streak-30",
  "streak-100",
  "first-pr",
  "prs-10",
  "first-checkin",
  "first-challenge",
  "nutrition-week",
] as const;
export type BadgeSlug = (typeof BADGE_SLUGS)[number];

export function isBadgeSlug(x: unknown): x is BadgeSlug {
  return typeof x === "string" && (BADGE_SLUGS as readonly string[]).includes(x);
}

/** The counts award_badges_for() reads. All of them are the owner's own rows. */
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

const THRESHOLDS: readonly [BadgeSlug, keyof BadgeFacts, number][] = [
  ["first-workout", "workouts", 1],
  ["workouts-10", "workouts", 10],
  ["workouts-50", "workouts", 50],
  ["workouts-100", "workouts", 100],
  ["streak-7", "longestStreak", 7],
  ["streak-30", "longestStreak", 30],
  ["streak-100", "longestStreak", 100],
  ["first-pr", "prs", 1],
  ["prs-10", "prs", 10],
  ["first-checkin", "checkins", 1],
  ["first-challenge", "challengesCompleted", 1],
  ["nutrition-week", "longestFoodRun", 7],
];

/** Every badge these facts earn, in catalog order. */
export function earnedBadges(facts: BadgeFacts): BadgeSlug[] {
  return THRESHOLDS.filter(([, key, min]) => (facts[key] ?? 0) >= min).map(([slug]) => slug);
}

/** Badges earned but not yet held — what the next award run would insert. */
export function newBadges(facts: BadgeFacts, held: Iterable<string>): BadgeSlug[] {
  const have = new Set(held);
  return earnedBadges(facts).filter((slug) => !have.has(slug));
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
