// Personal record detection (PRODUCT_SPEC Epic B3).
//
// Runs twice: on the device the moment a set is confirmed, so the celebration
// is instant even offline, and again server-side when the outbox syncs. One
// implementation keeps the two verdicts identical.

export type PerformedSet = {
  /** Load in kg. Bodyweight sets carry 0 and never produce a 1RM. */
  weight: number;
  reps: number;
};

/**
 * Epley, unrounded: 1RM = w · (1 + reps/30), with a single rep taken at face
 * value. This is the value analytics sums, sorts and charts with — 100 kg × 10
 * is 133.333…, and rounding it before it is compared is how two sets that
 * differ end up looking equal.
 *
 * Display rounds; storage and comparison do not.
 */
export function estimated1RMExact(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * The same estimate rounded to the one decimal a gym actually reads. This is
 * the PR judge's number and has been since the first release: isPersonalRecord
 * compares rounded against rounded, so a 20-gram difference never announces a
 * record.
 */
export function estimated1RM(weight: number, reps: number): number {
  return round1(estimated1RMExact(weight, reps));
}

export function isPersonalRecord(set: PerformedSet, bestSoFar: number | null): boolean {
  const candidate = estimated1RM(set.weight, set.reps);
  if (candidate <= 0) return false;
  return bestSoFar === null ? true : candidate > bestSoFar;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
