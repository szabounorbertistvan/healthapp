// Which program a client actually follows.
//
// A client can hold two published programs at once: one their coach wrote and
// one they built themselves before (or after) having a coach. Reading "the most
// recently updated" makes the winner arbitrary, so the rule is explicit: while a
// coach is active the coach decides, and the client's own program waits, intact,
// for the relationship to end.
//
// Inside each side, the program someone *activated* last wins
// (programs.activated_at, 20261125100000 — stamped by "Set as active" and by
// publishing). Editing a program bumps updated_at, so with updated_at alone a
// typo fixed in last month's block quietly made it the plan Today counts. Only
// when nothing on that side was ever activated (rows from before the column,
// and nutrition plans, which have no such column) does the newest edit decide,
// exactly as before — so an account that never touches the button sees no change.

export type SelectableProgram = {
  id: string;
  /** null = the client built this themselves. */
  coach_id: string | null;
  updated_at: string;
  /** When this program was last made the one to follow; null/absent = never. */
  activated_at?: string | null;
};

/** The followed program among one side's candidates: last activated, else last edited. */
function followedOf<T extends SelectableProgram>(candidates: readonly T[]): T | null {
  const activated = candidates.filter((p) => typeof p.activated_at === "string" && p.activated_at !== "");
  if (activated.length > 0) {
    return [...activated].sort((a, b) => b.activated_at!.localeCompare(a.activated_at!))[0] ?? null;
  }
  return [...candidates].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

export function pickProgram<T extends SelectableProgram>(
  programs: readonly T[],
  hasActiveCoach: boolean,
): T | null {
  if (hasActiveCoach) {
    const fromCoach = followedOf(programs.filter((p) => p.coach_id !== null));
    if (fromCoach) return fromCoach;
  }
  return followedOf(programs.filter((p) => p.coach_id === null));
}
