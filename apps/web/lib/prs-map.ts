// exercise_best_sets() rows → the personal-records list.
//
// The SQL picks each lift's best completed set; the value is computed here
// with relevantOneRm() — the exercise page's estimate — so the list and the
// exercise page show the same number for the same lift. Split out of
// client-training.ts ("server-only") so it can be tested.
import { relevantOneRm } from "@healthapp/shared";
import type { ClientPrRow } from "./types";

export type BestSetRow = {
  exercise_id: string;
  /** numeric — PostgREST may send it as a string. */
  weight_kg: number;
  reps: number;
  completed_at: string;
  name_en: string | null;
  name_ro: string | null;
};

export function toPrRows(rows: readonly BestSetRow[]): ClientPrRow[] {
  const out: ClientPrRow[] = [];
  for (const r of rows) {
    const best = relevantOneRm(Number(r.weight_kg), Number(r.reps));
    if (best === null) continue;
    out.push({
      // The name rule the list has always used.
      exercise: r.name_ro ?? r.name_en ?? "—",
      exercise_id: r.exercise_id,
      best,
      at: r.completed_at,
    });
  }
  return out.sort((a, b) => b.best - a.best || a.exercise.localeCompare(b.exercise));
}
