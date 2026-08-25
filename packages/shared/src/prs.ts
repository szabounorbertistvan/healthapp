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

/** Epley: 1RM = w · (1 + reps/30), with a single rep taken at face value. */
export function estimated1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return round1(weight * (1 + reps / 30));
}

export function isPersonalRecord(set: PerformedSet, bestSoFar: number | null): boolean {
  const candidate = estimated1RM(set.weight, set.reps);
  if (candidate <= 0) return false;
  return bestSoFar === null ? true : candidate > bestSoFar;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
