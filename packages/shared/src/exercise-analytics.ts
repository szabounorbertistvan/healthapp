// Per-exercise analytics: what you lifted last time, and whether you are
// progressing (PRODUCT_SPEC Epic B2 "exercise history").
//
// Everything here is pure and takes already-filtered rows, for the same reason
// macros and adherence are: the number under the set logger, the number on the
// exercise page and the number a snapshot post would carry must come from one
// implementation. The reads that feed it live in
// apps/web/lib/exercise-analytics-data.ts.
//
// Two rules this module exists to enforce:
//
//   1. Only COMPLETED sessions count. A workout someone opened and walked away
//      from is not "last time" — see previousWorkouts().
//   2. Weights are never rounded on the way through. 21.25 kg stays 21.25 kg;
//      rounding is a display decision and belongs to the component.

import { estimated1RMExact } from "./prs";

/**
 * One logged set as analytics reads it. `session_at` is the session's
 * completion time, not the set's: every set of one workout must sort and group
 * together even when the last one landed after midnight.
 */
export type AnalyticsSet = {
  id: string;
  session_id: string;
  /** ISO timestamp the session was completed. */
  session_at: string;
  /** The training day's name, for the history list. Null for an ad-hoc session. */
  session_name: string | null;
  exercise_id: string;
  /** program_exercises.id — null for sets logged before the link existed. */
  program_exercise_id: string | null;
  set_index: number;
  weight_kg: number;
  reps: number;
  /** Felt intensity 1..10. */
  rpe: number | null;
  /** Reps in reserve as typed (RIR programs). */
  rir: number | null;
  is_pr: boolean;
};

/** A set as the logger and the history list show it back. */
export type PerformedSetRow = {
  set_index: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  rir: number | null;
  is_pr: boolean;
};

export type PreviousWorkout = {
  session_id: string;
  /** ISO timestamp of the session that produced these sets. */
  at: string;
  /** In the order they were performed. */
  sets: PerformedSetRow[];
};

export type ExerciseSessionEntry = {
  session_id: string;
  at: string;
  name: string | null;
  sets: PerformedSetRow[];
  /** Sum of weight x reps, exact. */
  volume_kg: number;
  /** The heaviest load moved in this session. */
  top_weight_kg: number;
  /** The most reps done in any one set of this session. */
  top_reps: number;
  /** Best estimated 1RM of the session, unrounded; null when no set qualifies. */
  best_1rm: number | null;
};

export type ExerciseStats = {
  /** The most recent completed session's sets. */
  last: PreviousWorkout | null;
  best_weight_kg: number | null;
  /** Most reps in a single set, at any load. */
  best_reps: number | null;
  /** Most reps ever done at the heaviest load — "highest reps at a given weight". */
  best_reps_at_best_weight: number | null;
  /** Best single-session volume. */
  best_volume_kg: number | null;
  /** Best estimated 1RM, unrounded. Null when nothing qualifies (bodyweight, very high reps). */
  best_1rm: number | null;
  sessions: number;
  total_sets: number;
  total_volume_kg: number;
  /**
   * True when no set ever carried load: the page leads with reps instead of
   * kilograms, because "0 kg × 15" describes a push-up badly.
   */
  bodyweight: boolean;
};

/**
 * Above this many reps Epley stops describing a one-rep max and starts
 * describing endurance: at 20 reps it claims 167% of the load lifted, which
 * nobody would attempt. Analytics reports no estimate rather than a wrong one.
 * PR detection keeps its own, unbounded rule — changing that would silently
 * rewrite is_pr on rows already in the database.
 */
export const ONE_RM_MAX_REPS = 12;

/** weight x reps, exact — decimals survive (21.25 x 8 = 170). */
export function setVolume(weight_kg: number, reps: number): number {
  if (!Number.isFinite(weight_kg) || !Number.isFinite(reps)) return 0;
  if (weight_kg <= 0 || reps <= 0) return 0;
  return weight_kg * reps;
}

/**
 * Epley where Epley still means something: a positive load, at least one whole
 * rep, and no more than ONE_RM_MAX_REPS of them. Null — not zero — when it does
 * not apply, so a bodyweight set cannot drag a chart to the floor.
 */
export function relevantOneRm(weight_kg: number, reps: number): number | null {
  if (!Number.isFinite(weight_kg) || !Number.isFinite(reps)) return null;
  if (weight_kg <= 0 || reps <= 0) return null;
  if (!Number.isInteger(reps)) return null;
  if (reps > ONE_RM_MAX_REPS) return null;
  return estimated1RMExact(weight_kg, reps);
}

/** Sum of weight x reps over a list of sets, exact. */
export function totalVolume(sets: readonly { weight_kg: number; reps: number }[]): number {
  return sets.reduce((sum, s) => sum + setVolume(s.weight_kg, s.reps), 0);
}

function toRow(s: AnalyticsSet): PerformedSetRow {
  return { set_index: s.set_index, weight_kg: s.weight_kg, reps: s.reps, rpe: s.rpe, rir: s.rir, is_pr: s.is_pr };
}

function bySetIndex(a: PerformedSetRow, b: PerformedSetRow): number {
  return a.set_index - b.set_index;
}

/**
 * Newer of two sessions. Timestamps decide; when two sessions were completed
 * in the same instant (a bulk sync, a fixture) the id breaks the tie, so the
 * answer never depends on the order rows came back in.
 */
function isNewer(a: { at: string; session_id: string }, b: { at: string; session_id: string }): boolean {
  const byTime = a.at.localeCompare(b.at);
  return byTime !== 0 ? byTime > 0 : a.session_id.localeCompare(b.session_id) > 0;
}

/**
 * "What did I do last time on this?", for every exercise in one pass.
 *
 * The map is keyed twice: by `exercises.id`, and by `pe:<program_exercises.id>`
 * for the prescribed row. A day may program the same lift twice — heavy, then
 * a back-off block — and each block wants its own history rather than the
 * other one's numbers.
 *
 * `rows` must already be restricted to completed sessions; that is the caller's
 * one job, and the reason an abandoned workout can never become "previous".
 */
export function previousWorkouts(rows: readonly AnalyticsSet[]): Map<string, PreviousWorkout> {
  const best = new Map<string, { session_id: string; at: string; sets: PerformedSetRow[] }>();

  function offer(key: string, s: AnalyticsSet): void {
    const current = best.get(key);
    const candidate = { at: s.session_at, session_id: s.session_id };
    if (!current) {
      best.set(key, { ...candidate, sets: [toRow(s)] });
      return;
    }
    if (current.session_id === s.session_id) {
      current.sets.push(toRow(s));
      return;
    }
    if (isNewer(candidate, current)) best.set(key, { ...candidate, sets: [toRow(s)] });
  }

  for (const s of rows) {
    offer(s.exercise_id, s);
    if (s.program_exercise_id) offer(`pe:${s.program_exercise_id}`, s);
  }

  const out = new Map<string, PreviousWorkout>();
  for (const [key, v] of best) {
    out.set(key, { session_id: v.session_id, at: v.at, sets: [...v.sets].sort(bySetIndex) });
  }
  return out;
}

/** The previous workout for a prescribed row, falling back to the library exercise. */
export function previousFor(
  map: ReadonlyMap<string, PreviousWorkout>,
  ref: { programExerciseId?: string | null; exerciseId?: string | null },
): PreviousWorkout | null {
  if (ref.programExerciseId) {
    const byBlock = map.get(`pe:${ref.programExerciseId}`);
    if (byBlock) return byBlock;
  }
  if (ref.exerciseId) return map.get(ref.exerciseId) ?? null;
  return null;
}

/** Every completed session of one exercise, newest first, each already summed. */
export function exerciseSessions(rows: readonly AnalyticsSet[]): ExerciseSessionEntry[] {
  const bySession = new Map<string, ExerciseSessionEntry>();
  for (const s of rows) {
    let entry = bySession.get(s.session_id);
    if (!entry) {
      entry = {
        session_id: s.session_id, at: s.session_at, name: s.session_name,
        sets: [], volume_kg: 0, top_weight_kg: 0, top_reps: 0, best_1rm: null,
      };
      bySession.set(s.session_id, entry);
    }
    entry.sets.push(toRow(s));
  }

  const out = [...bySession.values()];
  for (const entry of out) {
    entry.sets.sort(bySetIndex);
    entry.volume_kg = totalVolume(entry.sets);
    entry.top_weight_kg = entry.sets.reduce((m, x) => Math.max(m, x.weight_kg), 0);
    entry.top_reps = entry.sets.reduce((m, x) => Math.max(m, x.reps), 0);
    for (const x of entry.sets) {
      const e = relevantOneRm(x.weight_kg, x.reps);
      if (e !== null && (entry.best_1rm === null || e > entry.best_1rm)) entry.best_1rm = e;
    }
  }
  // Newest first, id as the tie-break so the order is stable across renders.
  return out.sort((a, b) => b.at.localeCompare(a.at) || b.session_id.localeCompare(a.session_id));
}

/** The header figures on the exercise page, from the sessions above. */
export function exerciseStats(sessions: readonly ExerciseSessionEntry[]): ExerciseStats {
  const empty: ExerciseStats = {
    last: null, best_weight_kg: null, best_reps: null, best_reps_at_best_weight: null,
    best_volume_kg: null, best_1rm: null, sessions: 0, total_sets: 0, total_volume_kg: 0,
    bodyweight: false,
  };
  if (sessions.length === 0) return empty;

  const all = sessions.flatMap((s) => s.sets);
  const working = all.filter((s) => s.reps > 0);
  if (working.length === 0) {
    return { ...empty, sessions: sessions.length, total_sets: all.length };
  }

  const bestWeight = working.reduce((m, x) => Math.max(m, x.weight_kg), 0);
  const bestRepsAtBestWeight = working
    .filter((x) => x.weight_kg === bestWeight)
    .reduce((m, x) => Math.max(m, x.reps), 0);
  const best1rm = working.reduce<number | null>((m, x) => {
    const e = relevantOneRm(x.weight_kg, x.reps);
    return e !== null && (m === null || e > m) ? e : m;
  }, null);
  const newest = sessions[0];
  if (!newest) return { ...empty, sessions: sessions.length };

  return {
    last: { session_id: newest.session_id, at: newest.at, sets: newest.sets },
    best_weight_kg: bestWeight > 0 ? bestWeight : null,
    best_reps: working.reduce((m, x) => Math.max(m, x.reps), 0),
    best_reps_at_best_weight: bestWeight > 0 ? bestRepsAtBestWeight : null,
    best_volume_kg: sessions.reduce((m, s) => Math.max(m, s.volume_kg), 0),
    best_1rm: best1rm,
    sessions: sessions.length,
    total_sets: all.length,
    total_volume_kg: totalVolume(all),
    bodyweight: bestWeight <= 0,
  };
}

export type RepRecord = { reps: number; weight_kg: number; at: string };

/**
 * The heaviest load ever lifted for AT LEAST N reps, for N = 1…maxReps — the
 * rep-records table. "At least", so the table never claims a 5RM lighter than
 * something done for 6. A row appears only once a set reached that many reps;
 * the date is the first session to set that weight. Bodyweight sets (0 kg) are
 * left out. Capped at ONE_RM_MAX_REPS, the same line past which analytics
 * stops estimating a one-rep max.
 */
export function repRecords(sessions: readonly ExerciseSessionEntry[], maxReps = ONE_RM_MAX_REPS): RepRecord[] {
  const oldestFirst = [...sessions].sort((a, b) => a.at.localeCompare(b.at) || a.session_id.localeCompare(b.session_id));
  const best = new Map<number, RepRecord>();
  for (const s of oldestFirst) {
    for (const set of s.sets) {
      if (!(set.weight_kg > 0) || !(set.reps > 0)) continue;
      for (let n = 1; n <= Math.min(set.reps, maxReps); n++) {
        const current = best.get(n);
        if (!current || set.weight_kg > current.weight_kg) best.set(n, { reps: n, weight_kg: set.weight_kg, at: s.at });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps);
}

// ---------- charts ----------

/** "reps" is the most reps in one set of a session — the line a bodyweight exercise draws. */
export type ExerciseMetric = "weight" | "volume" | "one_rm" | "reps";
/** null = all time. */
export type ExerciseRangeDays = 7 | 30 | 90 | 365 | null;
export const EXERCISE_RANGES: ExerciseRangeDays[] = [7, 30, 90, 365, null];

export type MetricPoint = { day: string; value: number };

/**
 * One point per session, oldest first — a chart answers "am I progressing?",
 * which reads left to right.
 *
 * `todayIso` is passed rather than read from the clock so the window a test
 * asks about is the window it gets.
 */
export function metricSeries(
  sessions: readonly ExerciseSessionEntry[],
  metric: ExerciseMetric,
  range: ExerciseRangeDays,
  todayIso: string,
): MetricPoint[] {
  const from = range === null ? null : shiftIsoDay(todayIso, -(range - 1));
  const points: MetricPoint[] = [];
  for (const s of sessions) {
    const day = s.at.slice(0, 10);
    if (from !== null && day < from) continue;
    const value =
      metric === "weight" ? s.top_weight_kg
      : metric === "volume" ? s.volume_kg
      : metric === "reps" ? s.top_reps
      : s.best_1rm;
    if (value === null || value <= 0) continue;
    points.push({ day, value });
  }
  return points.reverse();
}

/**
 * The range to open on: 90 days when that window holds enough sessions to show
 * a trend, otherwise the widest one that does. A chart of one point is not a
 * trend, so "enough" is two.
 */
export function defaultRange(
  sessions: readonly ExerciseSessionEntry[],
  todayIso: string,
): ExerciseRangeDays {
  const inRange = (days: ExerciseRangeDays) => metricSeries(sessions, "volume", days, todayIso).length;
  if (inRange(90) >= 2) return 90;
  for (const days of [365, null] as ExerciseRangeDays[]) {
    if (inRange(days) >= 2) return days;
  }
  return 90;
}

function shiftIsoDay(day: string, delta: number): string {
  const [y = 1970, m = 1, d = 1] = day.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// ---------- progression ----------

export type ProgressionKind = "weight_up" | "weight_down" | "reps_up" | "reps_down" | "same";

export type Progression = {
  kind: ProgressionKind;
  /** Exact difference in kilograms; 0 when the load matched. */
  weight_delta_kg: number;
  reps_delta: number;
};

/**
 * Factual, never a verdict: the set just logged against the same set number of
 * the previous workout. Load moves first — adding 2.5 kg at one rep fewer is
 * still "heavier" — and reps only speak when the load did not change.
 *
 * Null when there is nothing to compare against, which is how the caller knows
 * to show nothing rather than "same as previous".
 */
export function progressionVs(
  current: { weight_kg: number; reps: number },
  previous: { weight_kg: number; reps: number } | null | undefined,
): Progression | null {
  if (!previous) return null;
  const weight_delta_kg = current.weight_kg - previous.weight_kg;
  const reps_delta = current.reps - previous.reps;
  // Half a gram is float noise from a pound round-trip, not a heavier lift.
  const sameWeight = Math.abs(weight_delta_kg) < 0.005;
  if (!sameWeight) {
    return { kind: weight_delta_kg > 0 ? "weight_up" : "weight_down", weight_delta_kg, reps_delta };
  }
  if (reps_delta !== 0) {
    return { kind: reps_delta > 0 ? "reps_up" : "reps_down", weight_delta_kg: 0, reps_delta };
  }
  return { kind: "same", weight_delta_kg: 0, reps_delta: 0 };
}

/**
 * What the kg and reps boxes open on for the set about to be logged.
 *
 * The order is the whole point: the SAME SET NUMBER of the last completed
 * session first, then whatever was logged today, then the coach's
 * prescription. Matching the set number is what makes a descending block work
 * — a day that ran 110×8 / 105×9 / 100×10 offers 105 for set 2 rather than
 * 110 again.
 *
 * A suggestion, never a constraint: the caller puts these into editable
 * fields, and typing over them is the expected case.
 */
export function prefillFor(input: {
  /** 1-based number of the set about to be logged. */
  setNumber: number;
  previous: PreviousWorkout | null;
  /** The most recent set logged today in this block, if any. */
  todaysLastSet: { weight_kg: number; reps: number } | null;
  /** program_exercises.target_weight_kg. */
  targetWeightKg: number | null;
  /** program_exercises.target_reps — "8" or a range like "8-10". */
  targetReps: string;
}): { weight_kg: number | null; reps: number | null } {
  const lastTime = previousSetFor(input.previous, input.setNumber);
  const target = parseInt(input.targetReps, 10);
  const weight = lastTime?.weight_kg ?? input.todaysLastSet?.weight_kg ?? input.targetWeightKg;
  const reps = lastTime?.reps ?? input.todaysLastSet?.reps ?? (Number.isFinite(target) ? target : null);
  return {
    weight_kg: weight !== null && weight !== undefined && weight > 0 ? weight : null,
    reps: reps !== null && reps !== undefined && reps > 0 ? reps : null,
  };
}

/** The set of the previous workout this one answers: same set number, else the last one. */
export function previousSetFor(previous: PreviousWorkout | null, setIndex: number): PerformedSetRow | null {
  if (!previous || previous.sets.length === 0) return null;
  return previous.sets.find((s) => s.set_index === setIndex)
    ?? previous.sets[previous.sets.length - 1]
    ?? null;
}

// ---------- social ----------

/**
 * Everything a snapshot post may carry about one set, and nothing else.
 *
 * Social v2 is not built yet; this is the shape it will be handed when it is.
 * Body weight, calories, measurements and nutrition are deliberately absent —
 * the existing share cards (lib/share-card.ts) carry performance only, and an
 * exercise snapshot must not become the hole that changes.
 */
export type ExerciseSnapshot = {
  exercise: string;
  weight_kg: number;
  reps: number;
  volume_kg: number;
  /** Rounded to one decimal — a card is display, not a comparison. */
  estimated_1rm: number | null;
  is_pr: boolean;
  /** ISO date, no time: when it happened, not at what hour. */
  date: string;
};

export function exerciseSnapshot(
  exercise: string,
  set: { weight_kg: number; reps: number; is_pr: boolean },
  at: string,
): ExerciseSnapshot {
  const oneRm = relevantOneRm(set.weight_kg, set.reps);
  return {
    exercise,
    weight_kg: set.weight_kg,
    reps: set.reps,
    volume_kg: setVolume(set.weight_kg, set.reps),
    estimated_1rm: oneRm === null ? null : Math.round(oneRm * 10) / 10,
    is_pr: set.is_pr,
    date: at.slice(0, 10),
  };
}
