import "server-only";
// One lift's whole history, and the PR flags re-derived over it. Shared by the
// set logger and editor (app/client-actions-training.ts) and the workout
// import (app/import-actions.ts) so the three judge records over the same rows
// in the same order — received_at, which an import sets to when the set was
// done rather than when the file arrived.
import { estimated1RM, recomputePrFlags } from "@healthapp/shared";
import type { LiveUser } from "./supabase/server";

export type HistorySet = { id: string; weight_kg: number | null; reps: number | null; is_pr: boolean; received_at: string };

/**
 * Every set of one lift, oldest first, paged past PostgREST's 1000-row cap so
 * the PR judge never decides on a truncated history.
 */
export async function setsOfExercise(
  supabase: LiveUser["supabase"],
  userId: string,
  exerciseId: string,
): Promise<HistorySet[]> {
  const PAGE = 1000;
  const rows: HistorySet[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("logged_sets")
      .select("id, weight_kg, reps, is_pr, received_at")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    rows.push(...((data ?? []) as HistorySet[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * Re-derives one lift's PR flags (recomputePrFlags over estimated1RM, both
 * from packages/shared) and writes only the ones that changed — in two
 * statements, one per value, since an import can move hundreds at once.
 * Returns how many flags moved, or null when a write failed.
 */
export async function recomputeExercisePrs(
  supabase: LiveUser["supabase"],
  userId: string,
  exerciseId: string,
): Promise<number | null> {
  const history = await setsOfExercise(supabase, userId, exerciseId);
  const changes = recomputePrFlags(
    history.map((s) => ({ ...s, weight_kg: Number(s.weight_kg ?? 0), reps: s.reps ?? 0 })),
    estimated1RM,
  );
  for (const value of [true, false]) {
    const ids = changes.filter((c) => c.is_pr === value).map((c) => c.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase
        .from("logged_sets")
        .update({ is_pr: value })
        .in("id", ids.slice(i, i + 200))
        .eq("user_id", userId);
      if (error) return null;
    }
  }
  return changes.length;
}
