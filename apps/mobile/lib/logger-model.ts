import type { LoggedSetV1, WorkoutDayV1, WorkoutExerciseV1 } from "@healthapp/api/v1";
import { kgToDisplay, type WeightUnit } from "@healthapp/shared";
import type { QueuedSet } from "./outbox-core";

// What the logger shows, computed from the day the server sent plus the sets
// still waiting on the phone. Pure, tested in logger-model.test.ts.

export type SetState = "synced" | "pending" | "refused";

export type DisplaySet = Omit<LoggedSetV1, "program_exercise_id" | "at"> & {
  state: SetState;
  /** The server's reason, on a refused set. */
  error?: string | null;
  at: string;
};

/**
 * Each exercise's sets for today: the server's, then the phone's waiting ones
 * that the server does not have yet (same exercise row + set number). A set the
 * outbox just delivered may still be in both lists until the day is re-read;
 * the server's copy wins.
 */
export function setsByExercise(day: WorkoutDayV1, queued: readonly QueuedSet[]): Record<string, DisplaySet[]> {
  const out: Record<string, DisplaySet[]> = {};
  for (const e of day.exercises) out[e.id] = [];
  const onServer = new Set<string>();
  for (const s of day.logged) {
    if (!s.program_exercise_id || !out[s.program_exercise_id]) continue;
    onServer.add(`${s.program_exercise_id}:${s.set_index}`);
    out[s.program_exercise_id]!.push({ ...s, state: "synced" });
  }
  for (const q of queued) {
    const i = q.input;
    if (i.dayId !== day.day_id || !out[i.programExerciseId]) continue;
    if (onServer.has(`${i.programExerciseId}:${i.setIndex}`)) continue;
    out[i.programExerciseId]!.push({
      set_index: i.setIndex,
      weight_kg: i.weightKg,
      reps: i.reps,
      duration_seconds: i.durationSeconds ?? null,
      rpe: i.rpe,
      rir: i.rir ?? null,
      notes: i.notes ?? null,
      is_pr: false,
      at: i.loggedAt,
      state: q.error ? "refused" : "pending",
      error: q.error ?? null,
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.set_index - b.set_index);
  return out;
}

/**
 * The number the next set gets. The web's rule (sets done + 1), counting only
 * sets that are or will be on record — a refused one keeps its number free.
 */
export function nextSetIndex(sets: readonly DisplaySet[]): number {
  return sets.filter((s) => s.state !== "refused").length + 1;
}

/** "8-10" → 8, "12" → 12, "AMRAP" → null. */
export function firstNumber(text: string): number | null {
  const m = /\d+(?:[.,]\d+)?/.exec(text);
  return m ? Number(m[0].replace(",", ".")) : null;
}

export type Prefill = { weight: string; reps: string };

/**
 * What the kg / reps (or seconds) boxes open with: the last set done today,
 * else the same set of last time's session, else the prescription. Weight in
 * the person's own unit.
 */
export function prefill(
  exercise: WorkoutExerciseV1,
  today: readonly DisplaySet[],
  previous: WorkoutDayV1["previous"],
  unit: WeightUnit,
): Prefill {
  const timed = exercise.measure === "time";
  const show = (kg: number) => String(kgToDisplay(kg, unit));
  const last = [...today].reverse().find((s) => s.state !== "refused");
  if (last) return { weight: show(last.weight_kg), reps: String(timed ? last.duration_seconds ?? "" : last.reps) };
  const before = exercise.exercise_id ? previous[exercise.exercise_id]?.sets : undefined;
  if (before && before.length > 0) {
    const same = before[Math.min(nextSetIndex(today) - 1, before.length - 1)]!;
    return { weight: show(same.weight_kg), reps: String(timed ? same.duration_seconds ?? "" : same.reps) };
  }
  const target = firstNumber(exercise.reps);
  return {
    weight: exercise.weight_kg != null ? show(exercise.weight_kg) : "",
    reps: target != null ? String(target) : "",
  };
}

/** "62,5" (a Romanian keyboard) and "62.5" both mean 62.5; anything else is NaN. */
export function parseDecimal(text: string): number {
  const t = text.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** Sets done per exercise row — what restAfterLoggedSet() counts. */
export function loggedCount(sets: Record<string, readonly DisplaySet[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, list] of Object.entries(sets)) out[id] = list.filter((s) => s.state !== "refused").length;
  return out;
}
