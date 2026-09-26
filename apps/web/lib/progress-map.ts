// The row shape the progress dashboard reads, and the mapping into the domain
// type. Split out of progress-data.ts ("server-only", untestable) so the rules
// worth pinning — completed sessions only, exact volume, the local day, the
// shared load score — can be tested.
import { localDay, totalVolume, type ProgressSession } from "@healthapp/shared";
import { loadOf, toLoadSet, type LoadSetJoin } from "./training-load";

/** What each set needs: the load inputs plus the PR flag. */
export const PROGRESS_SET_SELECT = "weight_kg, reps, rpe, rir, exercise_id, is_pr";

export type ProgressSessionJoin = {
  id: string;
  started_at: string;
  completed_at: string | null;
  logged_sets: (LoadSetJoin & { is_pr: boolean | null })[] | null;
};

/**
 * Join rows to scored sessions. The query already filters on completed_at;
 * this repeats the check for the reason toAnalyticsSets() does — an open
 * session counted as a workout would be invisible and wrong.
 */
export function toProgressSessions(rows: readonly ProgressSessionJoin[], timeZone: string): ProgressSession[] {
  const out: ProgressSession[] = [];
  for (const r of rows) {
    if (r.completed_at === null) continue;
    const sets = r.logged_sets ?? [];
    const numeric = sets.map((x) => ({ weight_kg: x.weight_kg ?? 0, reps: x.reps ?? 0 }));
    out.push({
      id: r.id,
      day: localDay(r.started_at, timeZone),
      load: loadOf(sets.map(toLoadSet), r.started_at, r.completed_at).score,
      volume_kg: totalVolume(numeric),
      sets: sets.length,
      prs: sets.filter((x) => x.is_pr).length,
      lifts: sets
        .filter((x): x is typeof x & { exercise_id: string } => x.exercise_id !== null)
        .map((x) => ({ exercise_id: x.exercise_id, weight_kg: x.weight_kg ?? 0, reps: x.reps ?? 0 })),
    });
  }
  return out;
}
