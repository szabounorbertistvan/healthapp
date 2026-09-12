// Challenges — progress toward a target over a date window, computed from the
// same session rollups the rest of the app already produces. Nothing here is
// entered by hand: a challenge's progress is a fold over logged sessions and
// active days, so it cannot be gamed and never needs recalculating on edit.

export type ChallengeType = "workouts" | "training_load" | "volume" | "active_days";

export const CHALLENGE_TYPES: readonly ChallengeType[] = ["workouts", "training_load", "volume", "active_days"];

export function isChallengeType(value: string): value is ChallengeType {
  return (CHALLENGE_TYPES as readonly string[]).includes(value);
}

/** One completed session, already scored — what every challenge type folds over. */
export type ChallengeSession = {
  /** Local yyyy-mm-dd the session was started on. */
  day: string;
  load: number;
  volume_kg: number;
};

export type ChallengeActivity = {
  sessions: ChallengeSession[];
  /** Days with any logged activity (session, food, habit) — the streak's definition. */
  active_days: string[];
};

export type ChallengeWindow = { start_date: string; end_date: string };

function inWindow(day: string, w: ChallengeWindow): boolean {
  return day >= w.start_date && day <= w.end_date;
}

/** Raw progress value in the challenge's own unit (count, points, kg, days). */
export function challengeProgress(type: ChallengeType, activity: ChallengeActivity, window: ChallengeWindow): number {
  const sessions = activity.sessions.filter((s) => inWindow(s.day, window));
  switch (type) {
    case "workouts":
      return sessions.length;
    case "training_load":
      return Math.round(sessions.reduce((sum, s) => sum + s.load, 0));
    case "volume":
      return Math.round(sessions.reduce((sum, s) => sum + s.volume_kg, 0));
    case "active_days": {
      const days = new Set<string>();
      for (const d of activity.active_days) if (inWindow(d, window)) days.add(d);
      for (const s of sessions) days.add(s.day);
      return days.size;
    }
  }
}

/** 0..100, integer; over-target clamps to 100 and a zero target is never "done". */
export function progressPct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / target) * 100)));
}

export function isChallengeComplete(value: number, target: number): boolean {
  return target > 0 && value >= target;
}

export type ChallengeStatus = "active" | "upcoming" | "completed" | "ended";

/**
 * Where a challenge sits for one person on a given day. `completed` wins over
 * the calendar — a finished challenge stays finished after the deadline.
 * "ended" is the window closing without the target being met.
 */
export function challengeStatus(window: ChallengeWindow, today: string, completed: boolean): ChallengeStatus {
  if (completed) return "completed";
  if (today < window.start_date) return "upcoming";
  if (today > window.end_date) return "ended";
  return "active";
}

/** Whole days until the end date inclusive of today; 0 once it has passed. */
export function daysRemaining(end_date: string, today: string): number {
  const ms = parseUtc(end_date) - parseUtc(today);
  return Math.max(0, Math.round(ms / 86_400_000) + 1);
}

/** A challenge accepts new participants until its last day, inclusive. */
export function canJoin(window: ChallengeWindow, today: string): boolean {
  return today <= window.end_date;
}

export type LeaderboardEntry<T = unknown> = T & { value: number };
export type RankedEntry<T = unknown> = LeaderboardEntry<T> & { rank: number };

/** Sorted by value, ties sharing a rank (1, 2, 2, 4) — "competition" ranking. */
export function rankParticipants<T>(entries: LeaderboardEntry<T>[]): RankedEntry<T>[] {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  let rank = 0;
  let previous: number | null = null;
  return sorted.map((e, i) => {
    if (previous === null || e.value < previous) rank = i + 1;
    previous = e.value;
    return { ...e, rank };
  });
}

function parseUtc(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
