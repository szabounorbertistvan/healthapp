// The one place a stored session becomes a training-load score. Every surface —
// history, the day page, Today, the coach roster — goes through here so the
// number is the same wherever it is read. The formula itself lives in
// @healthapp/shared; this file only adapts row shapes to it.
import { sessionDurationMin, trainingLoad, type TrainingLoad } from "@healthapp/shared";

/** What a set must carry to be scored — the demo store and the live rows both map onto it. */
export type LoadSetInput = {
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  /** Exercise id or name — only used to count distinct exercises. */
  exercise: string | null;
};

export function loadOf(
  sets: LoadSetInput[],
  started_at: string | null,
  completed_at: string | null,
): TrainingLoad {
  const names = new Set(sets.map((x) => x.exercise).filter((n): n is string => n !== null));
  return trainingLoad({
    sets: sets.map((x) => ({ weight_kg: x.weight_kg ?? 0, reps: x.reps ?? 0, rpe: x.rpe, rir: x.rir })),
    duration_min: sessionDurationMin(started_at, completed_at),
    exercise_count: names.size,
  });
}

/** The minimum a logged_sets row needs to be scored — what the Today and roster queries select. */
export const LOAD_SET_SELECT = "weight_kg, reps, rpe, rir, exercise_id";

export type LoadSetJoin = {
  weight_kg: number | null; reps: number | null; rpe: number | null; rir: number | null;
  exercise_id: string | null;
};

export function toLoadSet(x: LoadSetJoin): LoadSetInput {
  return { weight_kg: x.weight_kg, reps: x.reps, rpe: x.rpe, rir: x.rir, exercise: x.exercise_id };
}
