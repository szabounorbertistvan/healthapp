// Workout streaks — consecutive days with at least one completed session,
// counted on the user's own calendar, not UTC. Pure: the data layer hands in
// the completed sessions (or the per-day rollup the RPC returns) and the
// user's timezone; nothing here reads a table.
//
// One definition, used everywhere a streak or a workout day is shown:
//
//   active workout day = at least one completed logged_session whose
//   started_at falls on that local day (the day the workout began — the
//   same rule challenge_progress_rows() and the history screen use).
//
// A day with three workouts is one active day. The current streak ends today
// if the user trained today, or yesterday if they have not yet; two missed
// days in a row end it. Streak freezes / grace days are deliberately absent —
// `currentStreak` is the one place a future rule would go.
import { shiftDays } from "./weekly-summary";

export const DEFAULT_TIMEZONE = "Europe/Bucharest";
export const STREAK_CALENDAR_WEEKS = 12;
/** Ordered; a streak passes them one at a time. Ready for a badge engine to key on. */
export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 60, 90, 180, 365];
/** Milestones worth announcing to the feed. */
export const STREAK_SHARE_MIN = 7;

/** One active day and how many sessions were completed on it. */
export type WorkoutDay = { day: string; workouts: number };

export type StreakSummary = {
  current: number;
  longest: number;
  activeToday: boolean;
  activeYesterday: boolean;
  /** First day of the current streak; null when there is none. */
  streakStart: string | null;
  /** Most recent active day, whether or not it is part of the current streak. */
  lastActiveDate: string | null;
  /** The best streak that is NOT the current one — so "new record" can be told apart from "still the record". */
  longestBefore: number;
};

// ---------- calendar days in a timezone ----------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      // an unknown zone name (bad profile data) falls back to the app default rather than throwing
      f = new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/** The yyyy-mm-dd an instant falls on in `timeZone` (en-CA formats as ISO). */
export function localDay(instant: string | Date, timeZone: string): string {
  return formatterFor(timeZone).format(typeof instant === "string" ? new Date(instant) : instant);
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDay(now, timeZone);
}

// ---------- active days ----------

/**
 * Completed sessions → distinct local days with a count each, oldest first.
 * The day is where `started_at` falls in the user's zone (see header).
 */
export function getActiveWorkoutDays(
  sessions: readonly { started_at: string; completed_at: string | null }[],
  timeZone: string,
): WorkoutDay[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.completed_at === null) continue;
    const day = localDay(s.started_at, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([day, workouts]) => ({ day, workouts }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function isActiveDay(days: readonly WorkoutDay[], day: string): boolean {
  return days.some((d) => d.day === day && d.workouts > 0);
}

function daySet(days: readonly WorkoutDay[]): Set<string> {
  return new Set(days.filter((d) => d.workouts > 0).map((d) => d.day));
}

// ---------- streaks ----------

/** Consecutive runs of active days, oldest first: [start, end, length]. */
export function streakRuns(days: readonly WorkoutDay[]): { start: string; end: string; length: number }[] {
  const sorted = [...daySet(days)].sort();
  const runs: { start: string; end: string; length: number }[] = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last && shiftDays(last.end, 1) === day) {
      last.end = day;
      last.length++;
    } else {
      runs.push({ start: day, end: day, length: 1 });
    }
  }
  return runs;
}

/** The run that ends today or yesterday, else nothing. */
export function currentStreak(days: readonly WorkoutDay[], today: string): { current: number; streakStart: string | null } {
  const yesterday = shiftDays(today, -1);
  const run = streakRuns(days).find((r) => r.end === today || r.end === yesterday);
  return run ? { current: run.length, streakStart: run.start } : { current: 0, streakStart: null };
}

export function longestStreak(days: readonly WorkoutDay[]): number {
  return streakRuns(days).reduce((best, r) => Math.max(best, r.length), 0);
}

export function streakSummary(days: readonly WorkoutDay[], today: string): StreakSummary {
  const active = daySet(days);
  const runs = streakRuns(days);
  const { current, streakStart } = currentStreak(days, today);
  const longest = runs.reduce((best, r) => Math.max(best, r.length), 0);
  const longestBefore = runs.filter((r) => r.start !== streakStart).reduce((best, r) => Math.max(best, r.length), 0);
  const sorted = [...active].sort();
  return {
    current,
    longest: Math.max(longest, current),
    activeToday: active.has(today),
    activeYesterday: active.has(shiftDays(today, -1)),
    streakStart,
    lastActiveDate: sorted.length > 0 ? sorted[sorted.length - 1]! : null,
    longestBefore,
  };
}

// ---------- what just happened ----------

export type StreakEvent = "none" | "started" | "extended" | "record";

export type StreakStatus = {
  event: StreakEvent;
  /** The milestone the current streak sits on exactly, else null — so it fires once, on the day it is reached. */
  milestone: number | null;
};

/**
 * After a workout: did today start a streak, extend one, or set a record —
 * and did it land on a milestone? Everything derives from the summary, so a
 * refresh shows the same answer for the same day and never a second event.
 */
export function streakStatus(summary: StreakSummary): StreakStatus {
  if (!summary.activeToday || summary.current === 0) return { event: "none", milestone: null };
  const milestone = STREAK_MILESTONES.includes(summary.current) ? summary.current : null;
  if (summary.current === 1) return { event: "started", milestone };
  if (summary.current > summary.longestBefore) return { event: "record", milestone };
  return { event: "extended", milestone };
}

// ---------- milestones ----------

export type MilestoneReached = {
  milestone: number;
  /** The day the streak reached this length. */
  reached_on: string;
  /** Identifies the streak; (milestone, streak_start) is the once-only key. */
  streak_start: string;
  /** Whether that streak is still the current one. */
  current: boolean;
};

/**
 * Every milestone every streak in the history reached, newest first. Derived,
 * not stored: the same history always yields the same list, so there is no
 * event to duplicate. A share dedupes on (milestone, streak_start).
 */
export function milestonesReached(days: readonly WorkoutDay[], today: string): MilestoneReached[] {
  const { streakStart } = currentStreak(days, today);
  const out: MilestoneReached[] = [];
  for (const run of streakRuns(days)) {
    for (const m of STREAK_MILESTONES) {
      if (run.length < m) break;
      out.push({ milestone: m, reached_on: shiftDays(run.start, m - 1), streak_start: run.start, current: run.start === streakStart });
    }
  }
  return out.sort((a, b) => b.reached_on.localeCompare(a.reached_on) || b.milestone - a.milestone);
}

/** The next milestone above the current streak, for "3 days to go". */
export function nextMilestone(current: number): number | null {
  return STREAK_MILESTONES.find((m) => m > current) ?? null;
}

// ---------- calendar ----------

export type CalendarDay = { day: string; workouts: number; future: boolean };

/** Monday-based weekday index 0..6 of a yyyy-mm-dd. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

/**
 * The last `weeks` calendar weeks (Monday → Sunday) ending with the week
 * that holds `today`, each day with its workout count. Days after today are
 * flagged so the grid can leave them blank.
 */
export function streakCalendar(days: readonly WorkoutDay[], today: string, weeks: number = STREAK_CALENDAR_WEEKS): CalendarDay[][] {
  const counts = new Map(days.map((d) => [d.day, d.workouts]));
  const monday = shiftDays(today, -weekdayIndex(today));
  const first = shiftDays(monday, -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const day = shiftDays(first, w * 7 + i);
      return { day, workouts: counts.get(day) ?? 0, future: day > today };
    }),
  );
}
