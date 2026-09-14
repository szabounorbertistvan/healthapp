// Leaderboards — who trained the most, on five aggregate metrics, over a
// week, a month or all time. Pure: the ranking rules live here and the
// social_leaderboard() RPC mirrors them in SQL (the database does the heavy
// aggregation; this is the reference the pgTAP parity tests check against).
//
// Every score is derived from completed logged_sessions and reuses the
// definitions the rest of the app already has: training load per session is
// trainingLoadFromStats(), volume is Σ weight × reps over sets with reps, an
// active day is the streak engine's (started_at on the user's local day), a
// streak is streakRuns(). Nothing here ever sees a body weight, a calorie or
// a set: a row carries a name, an avatar and a number.
//
// Scope is `global` today; `club` and `gym` are the planned extensions — the
// RPC takes the argument now so the call sites need not change later.
import { streakRuns, type WorkoutDay } from "./streaks";
import { weekOf } from "./weekly-summary";

export type LeaderboardMetric = "training_load" | "volume" | "workouts" | "active_days" | "streak";
export type LeaderboardPeriod = "week" | "month" | "all";
export type LeaderboardScope = "global";
export type LeaderboardVisibility = "public" | "followers" | "private";

export const LEADERBOARD_METRICS: readonly LeaderboardMetric[] = ["training_load", "volume", "workouts", "active_days", "streak"];
export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = ["week", "month", "all"];
export const LEADERBOARD_SCOPES: readonly LeaderboardScope[] = ["global"];
export const LEADERBOARD_TOP = 10;

export function isLeaderboardMetric(x: unknown): x is LeaderboardMetric {
  return typeof x === "string" && (LEADERBOARD_METRICS as readonly string[]).includes(x);
}
export function isLeaderboardPeriod(x: unknown): x is LeaderboardPeriod {
  return typeof x === "string" && (LEADERBOARD_PERIODS as readonly string[]).includes(x);
}

// ---------- periods ----------

export type PeriodRange = { start: string | null; end: string };

/**
 * The calendar window a period covers, on the user's own calendar: `today`
 * is their local day. Week is Monday → Sunday, month is the calendar month,
 * all time has no start. `end` is today — nothing later exists yet.
 */
export function periodRange(period: LeaderboardPeriod, today: string): PeriodRange {
  if (period === "week") return { start: weekOf(today).start, end: today };
  if (period === "month") return { start: `${today.slice(0, 7)}-01`, end: today };
  return { start: null, end: today };
}

export function inRange(day: string, range: PeriodRange): boolean {
  return (range.start === null || day >= range.start) && day <= range.end;
}

// ---------- scoring ----------

/** One completed session, already rolled up: its local day, load and volume. */
export type SessionRollup = { user_id: string; day: string; load: number; volume_kg: number };

export type Score = { score: number; secondary: number };

/**
 * A user's score on a metric over a range, from their session rollups (all
 * of them — streaks need the days outside the window too). Secondary is the
 * tie-breaker the ranking uses before falling back to seniority.
 *
 *   training_load  Σ load             / volume
 *   volume         Σ volume           / sessions
 *   workouts       sessions           / volume
 *   active_days    distinct days      / sessions
 *   streak         longest run that touches the window (its full length,
 *                  not clipped to it) / active days in the window.
 *                  All time = the longest run ever.
 */
export function scoreOf(sessions: readonly SessionRollup[], metric: LeaderboardMetric, range: PeriodRange): Score {
  const inside = sessions.filter((s) => inRange(s.day, range));
  const volume = inside.reduce((sum, s) => sum + Math.max(0, s.volume_kg), 0);
  const days = new Set(inside.map((s) => s.day)).size;
  switch (metric) {
    case "training_load":
      return { score: inside.reduce((sum, s) => sum + s.load, 0), secondary: Math.round(volume) };
    case "volume":
      return { score: Math.round(volume), secondary: inside.length };
    case "workouts":
      return { score: inside.length, secondary: Math.round(volume) };
    case "active_days":
      return { score: days, secondary: inside.length };
    case "streak": {
      const runs = streakRuns(workoutDaysOf(sessions));
      const touching = runs.filter((r) => (range.start === null || r.end >= range.start) && r.start <= range.end);
      return { score: touching.reduce((best, r) => Math.max(best, r.length), 0), secondary: days };
    }
  }
}

function workoutDaysOf(sessions: readonly SessionRollup[]): WorkoutDay[] {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.day, (counts.get(s.day) ?? 0) + 1);
  return [...counts.entries()].map(([day, workouts]) => ({ day, workouts }));
}

// ---------- visibility ----------

/**
 * Whether a person appears on a leaderboard the viewer is looking at. The
 * setting is users.leaderboard_visibility (default public); a person always
 * sees their own row. Separate from post visibility on purpose — a private
 * post never reaches the feed, but the aggregate can still rank.
 */
export function visibleOnLeaderboard(
  person: { user_id: string; visibility: LeaderboardVisibility },
  viewerId: string,
  follows: ReadonlySet<string>,
): boolean {
  if (person.user_id === viewerId) return true;
  if (person.visibility === "public") return true;
  if (person.visibility === "followers") return follows.has(person.user_id);
  return false;
}

// ---------- ranking ----------

export type LeaderboardCandidate = {
  user_id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  /** Seniority, the last tie-breaker: the earlier member ranks first. */
  created_at: string;
};

export type LeaderboardRow = LeaderboardCandidate & {
  rank: number;
  score: number;
  secondary: number;
  is_current_user: boolean;
};

export type Leaderboard = {
  /** The top rows, in rank order. */
  entries: LeaderboardRow[];
  /** The viewer's own row when they rank at all — inside the top or below it. */
  me: LeaderboardRow | null;
  total: number;
};

/**
 * Deterministic order: score desc, secondary desc, seniority asc, id asc.
 * Only people with a score above zero take part — a quiet week is not a
 * last place. The same data always yields the same list.
 */
export function rankLeaderboard(
  candidates: readonly (LeaderboardCandidate & Score)[],
  viewerId: string,
  top: number = LEADERBOARD_TOP,
): Leaderboard {
  const ranked = candidates
    .filter((c) => c.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.secondary - a.secondary ||
        a.created_at.localeCompare(b.created_at) ||
        a.user_id.localeCompare(b.user_id),
    )
    .map((c, i) => ({ ...c, rank: i + 1, is_current_user: c.user_id === viewerId }));
  return {
    entries: ranked.slice(0, top),
    me: ranked.find((r) => r.is_current_user) ?? null,
    total: ranked.length,
  };
}

