// The one place a stored session becomes a training-load score. Every surface —
// history, the day page, Today, the coach roster — goes through here so the
// number is the same wherever it is read. The formula itself lives in
// @healthapp/shared; this file only adapts row shapes to it.
import { sessionDurationMin, trainingLoad, type TrainingLoad } from "@healthapp/shared";

/** What a set must carry to be scored. */
export type LoadSetInput = {
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  /** Exercise id or name — only used to count distinct exercises. */
  exercise: string | null;
  /** Logged against a warm-up prescription — no volume (totalVolume's rule). */
  warmup?: boolean;
};

export function loadOf(
  sets: LoadSetInput[],
  started_at: string | null,
  completed_at: string | null,
): TrainingLoad {
  const names = new Set(sets.map((x) => x.exercise).filter((n): n is string => n !== null));
  return trainingLoad({
    sets: sets.map((x) => ({ weight_kg: x.weight_kg ?? 0, reps: x.reps ?? 0, rpe: x.rpe, rir: x.rir, warmup: x.warmup === true })),
    duration_min: sessionDurationMin(started_at, completed_at),
    exercise_count: names.size,
  });
}

/**
 * The minimum a logged_sets row needs to be scored — what the Today and roster
 * queries select. The prescription's set_type is how a warm-up is told apart.
 */
export const LOAD_SET_SELECT = "weight_kg, reps, rpe, rir, exercise_id, prescribed:program_exercises(set_type)";

export type LoadSetJoin = {
  weight_kg: number | null; reps: number | null; rpe: number | null; rir: number | null;
  exercise_id: string | null;
  /** Optional: a reader that did not select it counts every set as working. */
  prescribed?: { set_type: string | null } | null;
};

export function isWarmupJoin(x: { prescribed?: { set_type: string | null } | null }): boolean {
  return x.prescribed?.set_type === "warmup";
}

export function toLoadSet(x: LoadSetJoin): LoadSetInput {
  return { weight_kg: x.weight_kg, reps: x.reps, rpe: x.rpe, rir: x.rir, exercise: x.exercise_id, warmup: isWarmupJoin(x) };
}
