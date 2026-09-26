// Challenges — a target over a date window.
//
// Progress for every type, completion, milestones and the leaderboard are
// computed in the database from what people logged (challenge_value(),
// challenge_sync(), challenge_leaderboard() in
// supabase/migrations/20261001100000_advanced_challenges.sql), on each
// member's own calendar. Nothing a client sends is progress. This module holds
// what the page decides FROM those numbers — percentage, milestones passed,
// status, days left, units, categories and discovery filters — and the
// milestone rule the SQL mirrors.

export const CHALLENGE_TYPES = [
  "workouts",
  "training_load",
  "volume",
  "active_days",
  "exercise_sessions",
  "strength_gain",
  "check_ins",
  "nutrition_days",
  "habit_completions",
] as const;
export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

export function isChallengeType(value: string): value is ChallengeType {
  return (CHALLENGE_TYPES as readonly string[]).includes(value);
}

/** What a challenge's number counts. */
export type ChallengeUnit = "workouts" | "points" | "kg" | "days" | "sessions" | "percent" | "check_ins" | "habits";

const UNIT: Record<ChallengeType, ChallengeUnit> = {
  workouts: "workouts",
  training_load: "points",
  volume: "kg",
  active_days: "days",
  exercise_sessions: "sessions",
  strength_gain: "percent",
  check_ins: "check_ins",
  nutrition_days: "days",
  habit_completions: "habits",
};

export function challengeUnit(type: ChallengeType): ChallengeUnit {
  return UNIT[type];
}

export const CHALLENGE_CATEGORIES = ["training", "strength", "consistency", "nutrition", "habits"] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];

const CATEGORY: Record<ChallengeType, ChallengeCategory> = {
  workouts: "training",
  training_load: "training",
  volume: "training",
  exercise_sessions: "training",
  strength_gain: "strength",
  active_days: "consistency",
  check_ins: "consistency",
  nutrition_days: "nutrition",
  habit_completions: "habits",
};

/** Derived, not stored: the type already says what a challenge is about. */
export function challengeCategory(type: ChallengeType): ChallengeCategory {
  return CATEGORY[type];
}

/** Mirrors the constraint challenges_exercise_matches_type. */
export function requiresExercise(type: ChallengeType): boolean {
  return type === "exercise_sessions" || type === "strength_gain";
}

export const CHALLENGE_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type ChallengeDifficulty = (typeof CHALLENGE_DIFFICULTIES)[number];

export function isChallengeDifficulty(value: unknown): value is ChallengeDifficulty {
  return typeof value === "string" && (CHALLENGE_DIFFICULTIES as readonly string[]).includes(value);
}

export type ChallengeWindow = { start_date: string; end_date: string };

// ---------- progress, as the page reads it ----------

/** value / target as a percentage, exact and unclamped (over-target is > 100); null without a target. */
export function challengePct(value: number, target: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return null;
  return (value * 100) / target;
}

export function isChallengeComplete(value: number, target: number): boolean {
  return target > 0 && value >= target;
}

export const CHALLENGE_MILESTONES = [25, 50, 75, 100] as const;
export type ChallengeMilestone = (typeof CHALLENGE_MILESTONES)[number];

/**
 * The steps a value has passed. Mirrors challenge_sync(): `v × 100 ≥ m × target`
 * — no division, so a step is reached exactly at its boundary.
 */
export function challengeMilestonesReached(value: number, target: number): ChallengeMilestone[] {
  if (!Number.isFinite(value) || !(target > 0)) return [];
  return CHALLENGE_MILESTONES.filter((m) => value * 100 >= m * target);
}

// ---------- the calendar ----------

export type ChallengeStatus = "active" | "upcoming" | "completed" | "ended";

/**
 * Where a challenge sits for one person on a given day — their LOCAL day
 * (challenge_cards returns it as local_today). `completed` wins over the
 * calendar: a finished challenge stays finished after the deadline. "ended" is
 * the window closing without the target being met.
 */
export function challengeStatus(window: ChallengeWindow, today: string, completed: boolean): ChallengeStatus {
  if (completed) return "completed";
  if (today < window.start_date) return "upcoming";
  if (today > window.end_date) return "ended";
  return "active";
}

/** Whole calendar days until the end date, inclusive of today; 0 once it has passed. */
export function daysRemaining(end_date: string, today: string): number {
  const ms = parseUtc(end_date) - parseUtc(today);
  return Math.max(0, Math.round(ms / 86_400_000) + 1);
}

/** A challenge accepts new participants until its last (local) day, inclusive — as participants_join. */
export function canJoin(window: ChallengeWindow, today: string): boolean {
  return today <= window.end_date;
}

export type ChallengeDuration = "week" | "month" | "long";

/** Up to 7 days, up to 31, or longer. */
export function challengeDurationBucket(window: ChallengeWindow): ChallengeDuration {
  const days = Math.round((parseUtc(window.end_date) - parseUtc(window.start_date)) / 86_400_000) + 1;
  return days <= 7 ? "week" : days <= 31 ? "month" : "long";
}

// ---------- discovery ----------

export type ChallengeFilter = {
  status: "active" | "upcoming" | "completed" | null;
  category: ChallengeCategory | null;
  difficulty: ChallengeDifficulty | null;
  duration: ChallengeDuration | null;
  q: string | null;
};

const STATUS_FILTERS = ["active", "upcoming", "completed"] as const;
const DURATIONS: readonly ChallengeDuration[] = ["week", "month", "long"];

export function normalizeChallengeFilter(raw: Record<string, string | undefined | null>): ChallengeFilter {
  const q = raw.q?.trim();
  return {
    status: (STATUS_FILTERS as readonly string[]).includes(raw.status ?? "") ? (raw.status as ChallengeFilter["status"]) : null,
    category: (CHALLENGE_CATEGORIES as readonly string[]).includes(raw.category ?? "") ? (raw.category as ChallengeCategory) : null,
    difficulty: isChallengeDifficulty(raw.difficulty) ? raw.difficulty : null,
    duration: (DURATIONS as readonly string[]).includes(raw.duration ?? "") ? (raw.duration as ChallengeDuration) : null,
    q: q ? q.slice(0, 80) : null,
  };
}

/** "Completed" as a filter means "finished" — done, or over without being done. */
export function matchesChallengeFilter(
  card: { title: string; type: ChallengeType; difficulty: ChallengeDifficulty | null; status: ChallengeStatus } & ChallengeWindow,
  f: ChallengeFilter,
): boolean {
  if (f.status === "completed" ? card.status !== "completed" && card.status !== "ended" : f.status !== null && card.status !== f.status) {
    return false;
  }
  if (f.category && challengeCategory(card.type) !== f.category) return false;
  if (f.difficulty && card.difficulty !== f.difficulty) return false;
  if (f.duration && challengeDurationBucket(card) !== f.duration) return false;
  if (f.q && !card.title.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

function parseUtc(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
