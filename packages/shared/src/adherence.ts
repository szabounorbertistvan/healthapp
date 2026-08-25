// Adherence engine — the single source of truth for "how is this client doing?".
//
// This file is mirrored by compute_adherence_snapshots() in
// supabase/migrations/20260823000900_functions.sql. The snapshot is computed
// server-side (plan §3.2); this module exists so mobile and web can explain and
// preview the same number without recomputing it differently.
//
// Weights and thresholds are PRODUCT_SPEC §7 v1 — still to be validated with the
// partner. Every change bumps FORMULA_VERSION so stored snapshots stay readable.

export const FORMULA_VERSION = 1;

/** A solo client has no planned days, so consistency is measured against this. */
const SOLO_SESSIONS_PER_WEEK = 3;

const WEIGHTS = { workout: 0.4, nutrition: 0.3, habits: 0.15, checkin: 0.15 } as const;

export type AdherenceSignal = "on_track" | "needs_attention" | "at_risk";

export type AdherenceInputs = {
  /** Published program days for the week; 0 for a solo client. */
  plannedSessions: number;
  completedSessions: number;
  /** Distinct days with at least one food log, 0–7. */
  daysLogged: number;
  /** 0–1, from macroScore(). */
  macroScore: number;
  habitTicks: number;
  habitScheduled: number;
  checkinSubmitted: boolean;
  /** Days since the last set, food log or habit tick. 99 when never active. */
  inactiveDays: number;
};

export type AdherenceResult = {
  workout: number;
  nutrition: number;
  habits: number;
  checkin: boolean;
  overall: number;
  signal: AdherenceSignal;
  /** Plain-language explanation — a signal a coach cannot justify is unusable. */
  reason: string;
  formulaVersion: number;
};

export function computeAdherence(i: AdherenceInputs): AdherenceResult {
  const planned = Math.min(i.plannedSessions, 7);
  const workout = Math.min(
    i.completedSessions / (planned === 0 ? SOLO_SESSIONS_PER_WEEK : planned),
    1,
  );
  const nutrition = 0.6 * (i.daysLogged / 7) + 0.4 * i.macroScore;
  const habits = i.habitScheduled === 0 ? 0 : Math.min(i.habitTicks / i.habitScheduled, 1);

  // Components stay unrounded here and are rounded only for storage/display —
  // same as the SQL, which rounds on insert.
  const overall = round3(
    WEIGHTS.workout * workout +
      WEIGHTS.nutrition * nutrition +
      WEIGHTS.habits * habits +
      WEIGHTS.checkin * (i.checkinSubmitted ? 1 : 0),
  );

  return {
    workout: round3(workout),
    nutrition: round3(nutrition),
    habits: round3(habits),
    checkin: i.checkinSubmitted,
    overall,
    signal: signalFor(overall, i.checkinSubmitted, i.inactiveDays),
    reason: explain(i, planned, habits),
    formulaVersion: FORMULA_VERSION,
  };
}

/** Inactivity overrides the score: a perfect week that stopped five days ago is not on track. */
export function signalFor(
  overall: number,
  checkinSubmitted: boolean,
  inactiveDays: number,
): AdherenceSignal {
  if (overall < 0.5 || inactiveDays >= 5) return "at_risk";
  if (overall < 0.8 || !checkinSubmitted || inactiveDays >= 3) return "needs_attention";
  return "on_track";
}

/** Average per-day closeness to the kcal target, floored at 0 per day. */
export function macroScore(days: readonly { kcal: number }[], kcalTarget: number): number {
  if (days.length === 0 || kcalTarget <= 0) return 0;
  const total = days.reduce(
    (sum, day) => sum + Math.max(0, 1 - Math.abs(day.kcal - kcalTarget) / kcalTarget),
    0,
  );
  return round3(total / days.length);
}

function explain(i: AdherenceInputs, planned: number, habits: number): string {
  const target = planned === 0 ? SOLO_SESSIONS_PER_WEEK : planned;
  const stalled =
    i.inactiveDays >= 3 && i.inactiveDays < 99 ? ` · no logs for ${i.inactiveDays} days` : "";
  return (
    `${i.completedSessions}/${target} workouts · food logged ${i.daysLogged}/7 days · ` +
    `habits ${Math.round(habits * 100)}% · check-in ${i.checkinSubmitted ? "done" : "missed"}${stalled}`
  );
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
