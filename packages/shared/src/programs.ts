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
