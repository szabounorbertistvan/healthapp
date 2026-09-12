// Training load — one 0..100 score per logged session, and the week-over-week
// arithmetic built on it. Computed at read time from logged_sets and the
// session timestamps; nothing is stored, so history never drifts from the
// formula and there is no engine table to backfill.
//
// The score is a weighted blend of saturating curves, one per signal, in the
// order PRODUCT_SPEC ranks them: volume, sets, duration, intensity, exercise
// count. A signal the session does not carry (no timestamps, no RPE/RIR) is
// left out and the remaining weights are renormalised — the score never
// pretends to know something the client did not log. Intensity is what
// separates a heavy 5×3 from a long pump session of the same tonnage.

export type LoadSet = {
  /** Load in kg; bodyweight sets carry 0 and contribute only to the set count. */
  weight_kg: number;
  reps: number;
  /** Felt intensity 1..10 (the slider), if logged. */
  rpe?: number | null;
  /** Reps in reserve as typed in an RIR program, if logged. */
  rir?: number | null;
};

export type TrainingLoadInput = {
  sets: LoadSet[];
  /** Wall-clock length of the session; null when it was not recorded. */
  duration_min?: number | null;
  /** Distinct exercises; derived from `exercise` on the sets when omitted. */
  exercise_count?: number | null;
};

export type TrainingLoadCategory = "very_light" | "light" | "moderate" | "hard" | "very_hard";

export type TrainingLoad = {
  /** 0..100, integer. */
  score: number;
  category: TrainingLoadCategory;
  volume_kg: number;
  sets: number;
  duration_min: number | null;
  /** Mean effective RPE over the sets that carried one, else null. */
  intensity: number | null;
  exercises: number;
};

/** Relative weight of each signal when every one is present. */
const WEIGHTS = { volume: 0.4, sets: 0.25, duration: 0.15, intensity: 0.15, exercises: 0.05 } as const;

// Half-life style constants: the input at which a curve reaches ~63/100.
const VOLUME_SCALE_KG = 8000;
const SETS_SCALE = 18;
const DURATION_SCALE_MIN = 60;
const EXERCISES_SCALE = 5;

/** Sessions shorter than a minute or longer than six hours were not timed. */
export const MAX_SESSION_MIN = 360;

/** 0..100 along 1 − e^(−x/scale): fast early growth, saturating late. */
function saturate(x: number, scale: number): number {
  if (x <= 0) return 0;
  return 100 * (1 - Math.exp(-x / scale));
}

/** Effective RPE of one set: the slider if present, else 10 − RIR. */
export function effectiveRpe(set: Pick<LoadSet, "rpe" | "rir">): number | null {
  if (typeof set.rpe === "number" && Number.isFinite(set.rpe)) return clamp(set.rpe, 1, 10);
  if (typeof set.rir === "number" && Number.isFinite(set.rir)) return clamp(10 - set.rir, 1, 10);
  return null;
}

export function trainingLoad(input: TrainingLoadInput): TrainingLoad {
  const sets = input.sets.filter((s) => Number.isFinite(s.reps) && s.reps > 0);
  const volume = sets.reduce((sum, s) => sum + Math.max(0, s.weight_kg || 0) * s.reps, 0);

  const rpes = sets.map(effectiveRpe).filter((r): r is number => r !== null);
  const intensity = rpes.length > 0 ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;

  const duration =
    typeof input.duration_min === "number" &&
    Number.isFinite(input.duration_min) &&
    input.duration_min >= 1 &&
    input.duration_min <= MAX_SESSION_MIN
      ? input.duration_min
      : null;

  const exercises = Math.max(0, Math.round(input.exercise_count ?? 0));

  if (sets.length === 0) {
    return { score: 0, category: "very_light", volume_kg: 0, sets: 0, duration_min: duration, intensity, exercises };
  }

  // Each present signal contributes weight × curve; absent ones drop out and
  // the total is divided by the weight that was actually available.
  let weighted = 0;
  let available = 0;

  weighted += WEIGHTS.volume * saturate(volume, VOLUME_SCALE_KG);
  available += WEIGHTS.volume;

  weighted += WEIGHTS.sets * saturate(sets.length, SETS_SCALE);
  available += WEIGHTS.sets;

  if (duration !== null) {
    weighted += WEIGHTS.duration * saturate(duration, DURATION_SCALE_MIN);
    available += WEIGHTS.duration;
  }

  if (intensity !== null) {
    // RPE 4 and below is warm-up territory (0); RPE 10 is maximal (100).
    weighted += WEIGHTS.intensity * clamp(((intensity - 4) / 6) * 100, 0, 100);
    available += WEIGHTS.intensity;
  }

  if (exercises > 0) {
    weighted += WEIGHTS.exercises * saturate(exercises, EXERCISES_SCALE);
    available += WEIGHTS.exercises;
  }

  const score = clamp(Math.round(weighted / available), 0, 100);
  return {
    score,
    category: trainingLoadCategory(score),
    volume_kg: Math.round(volume),
    sets: sets.length,
    duration_min: duration,
    intensity: intensity === null ? null : Math.round(intensity * 10) / 10,
    exercises,
  };
}

export function trainingLoadCategory(score: number): TrainingLoadCategory {
  if (score >= 85) return "very_hard";
  if (score >= 70) return "hard";
  if (score >= 50) return "moderate";
  if (score >= 30) return "light";
  return "very_light";
}

/** Minutes between two ISO timestamps, or null when either is missing or the span is implausible. */
export function sessionDurationMin(started_at: string | null, completed_at: string | null): number | null {
  if (!started_at || !completed_at) return null;
  const ms = new Date(completed_at).getTime() - new Date(started_at).getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.round(ms / 60_000);
  return min >= 1 && min <= MAX_SESSION_MIN ? min : null;
}

// ---------- weekly totals ----------

export type LoadTrendDirection = "increased" | "decreased" | "stable";

export type LoadTrend = {
  current: number;
  previous: number;
  /** Signed percentage change, one decimal; null when there is no previous load to compare against. */
  delta_pct: number | null;
  direction: LoadTrendDirection;
};

/** Change under this share of the previous total reads as "stable". */
export const STABLE_BAND = 0.05;

export function loadTrend(current: number, previous: number): LoadTrend {
  if (previous <= 0) {
    return {
      current,
      previous,
      delta_pct: null,
      direction: current > 0 ? "increased" : "stable",
    };
  }
  const ratio = (current - previous) / previous;
  const direction: LoadTrendDirection =
    Math.abs(ratio) < STABLE_BAND ? "stable" : ratio > 0 ? "increased" : "decreased";
  return { current, previous, delta_pct: Math.round(ratio * 1000) / 10, direction };
}

/** Sum of `load` over entries whose `day` (yyyy-mm-dd) falls in [from, to]. */
export function sumLoad(entries: { day: string; load: number }[], from: string, to: string): number {
  return entries.reduce((sum, e) => (e.day >= from && e.day <= to ? sum + e.load : sum), 0);
}

/** One total per requested day, zero where nothing was trained — the chart's bars. */
export function dailyLoad(
  entries: { day: string; load: number }[],
  days: string[],
): { day: string; load: number }[] {
  const byDay = new Map<string, number>();
  for (const e of entries) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.load);
  return days.map((day) => ({ day, load: byDay.get(day) ?? 0 }));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
