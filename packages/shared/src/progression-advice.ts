// What to try on the next set, from the same set number last time — double
// progression: climb the coach's rep range at one load, and once the top of
// the range is reached without a max effort, add the smallest sensible plate
// and start again at the bottom. A Premium suggestion shown beside the boxes;
// the boxes themselves keep opening on last time (prefillFor), so nothing
// changes for someone who ignores it.
import { previousSetFor, type PreviousWorkout, type PerformedSetRow } from "./exercise-analytics";
import { displayToKg, kgToDisplay, type WeightUnit } from "./units";

export type SetAdviceReason =
  /** Last time reached the top of the range: more load, back to the bottom. */
  | "add_weight"
  /** Inside the range (or no range given): one more rep at the same load. */
  | "add_rep"
  /** Last time fell short of the range: same load, aim for the bottom of it. */
  | "hold_missed"
  /** Last time was a max effort (RPE 10 / RIR 0): repeat it before moving on. */
  | "hold_hard";

export type SetAdvice = {
  weight_kg: number;
  reps: number;
  reason: SetAdviceReason;
  /** The set this answers: same set number of the last completed session. */
  from: PerformedSetRow;
};

/** "8-10", "8–10", "8 - 10" → 8..10; "8" → 8..8; anything else (AMRAP, empty) → null. */
export function parseRepRange(target: string): { lo: number; hi: number } | null {
  const m = target.trim().match(/^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] === undefined ? lo : Number(m[2]);
  if (lo <= 0 || hi < lo) return null;
  return { lo, hi };
}

/**
 * The next load up, in kilograms, landing on a number the person's own unit
 * shows cleanly: +5 lb for pound users, +2.5 kg on a bar, +1 kg under 20 kg
 * (dumbbells, cables), where 2.5 kg is a 10%+ jump.
 */
export function nextLoadKg(weightKg: number, unit: WeightUnit): number {
  if (unit === "lb") return displayToKg(kgToDisplay(weightKg, "lb") + 5, "lb");
  return weightKg + (weightKg < 20 ? 1 : 2.5);
}

/** A set the person rated as all they had: RIR 0 when typed, else felt intensity 10. */
function maxEffort(s: PerformedSetRow): boolean {
  if (s.rir !== null) return s.rir <= 0;
  return s.rpe !== null && s.rpe >= 10;
}

/**
 * The suggestion for set `setNumber`, or null when there is nothing honest to
 * say: no previous session on this lift, or a timed set (a hold progresses in
 * seconds, which this does not model).
 */
export function nextSetAdvice(input: {
  setNumber: number;
  previous: PreviousWorkout | null;
  /** program_exercises.target_reps — "8" or "8-10". */
  targetReps: string;
  unit: WeightUnit;
}): SetAdvice | null {
  const from = previousSetFor(input.previous, input.setNumber);
  if (!from || from.duration_seconds || from.reps <= 0) return null;
  const range = parseRepRange(input.targetReps);
  const hold = (reason: SetAdviceReason, reps = from.reps): SetAdvice => ({ weight_kg: from.weight_kg, reps, reason, from });

  if (maxEffort(from)) return hold("hold_hard");
  if (range && from.reps < range.lo) return hold("hold_missed", range.lo);
  // Bodyweight has no plate to add: reps are the only way up.
  if (range && from.reps >= range.hi && from.weight_kg > 0) {
    return { weight_kg: nextLoadKg(from.weight_kg, input.unit), reps: range.lo, reason: "add_weight", from };
  }
  return hold("add_rep", from.reps + 1);
}
