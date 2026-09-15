// Which program a client actually follows.
//
// A client can hold two published programs at once: one their coach wrote and
// one they built themselves before (or after) having a coach. Reading "the most
// recently updated" makes the winner arbitrary, so the rule is explicit: while a
// coach is active the coach decides, and the client's own program waits, intact,
// for the relationship to end.

export type SelectableProgram = {
  id: string;
  /** null = the client built this themselves. */
  coach_id: string | null;
  updated_at: string;
};

export function pickProgram<T extends SelectableProgram>(
  programs: readonly T[],
  hasActiveCoach: boolean,
): T | null {
  const newestFirst = [...programs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (hasActiveCoach) {
    const fromCoach = newestFirst.find((p) => p.coach_id !== null);
    if (fromCoach) return fromCoach;
  }
  return newestFirst.find((p) => p.coach_id === null) ?? null;
}

/**
 * Rough length of a training day, in whole minutes: every set costs its rest
 * plus ~40 s of work. Coaches never type a duration, so this is the only
 * number the client app can show before the first session; the training-load
 * engine measures the real one afterwards. `rest_seconds` null = 90 s, the
 * builder's default.
 */
export function estimateDayMinutes(
  exercises: readonly { sets: number; rest_seconds: number | null }[],
  secondsPerSet = 40,
  defaultRest = 90,
): number {
  const seconds = exercises.reduce((sum, e) => sum + e.sets * ((e.rest_seconds ?? defaultRest) + secondsPerSet), 0);
  return Math.max(1, Math.round(seconds / 60));
}
