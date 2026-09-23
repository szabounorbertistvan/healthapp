// One exercise's history for one person: every session it was trained in,
// the best of each, and the rep records — the numbers the exercise page shows.
// Pure, so the page, a coach view and (later) mobile read the same figures.
//
// 1RM is Epley via estimated1RM (prs.ts), the same formula PR detection uses,
// so "best estimated 1RM" here is always the number that earned the PR badge.
import { estimated1RM } from "./prs";

export type ExerciseSetInput = {
  session_id: string;
  /** When the session started (ISO). Sessions sort and chart by this. */
  session_at: string;
  set_index: number;
  /** kg; null or 0 for bodyweight. */
  weight_kg: number | null;
  reps: number;
  is_pr?: boolean;
};

export type ExerciseSessionSet = { set_index: number; weight_kg: number; reps: number; e1rm: number; is_pr: boolean };

export type ExerciseSession = {
  session_id: string;
  at: string;
  sets: ExerciseSessionSet[];
  /** Best Epley 1RM of the session, 0 when no set carried load. */
  best_e1rm: number;
  /** Heaviest load lifted, and for how many reps (the most reps at that load). */
  heaviest: { weight_kg: number; reps: number };
  /** Σ weight × reps. */
  volume_kg: number;
  /** Most reps in one set — the figure that matters for a bodyweight exercise. */
  max_reps: number;
};

/** Sets grouped into sessions, newest session first, sets in order. Zero-rep sets are skipped. */
export function exerciseSessions(rows: readonly ExerciseSetInput[]): ExerciseSession[] {
  const byId = new Map<string, { at: string; sets: ExerciseSessionSet[] }>();
  for (const r of rows) {
    if (r.reps <= 0) continue;
    const weight = r.weight_kg && r.weight_kg > 0 ? r.weight_kg : 0;
    const entry = byId.get(r.session_id) ?? { at: r.session_at, sets: [] };
    entry.sets.push({ set_index: r.set_index, weight_kg: weight, reps: r.reps, e1rm: estimated1RM(weight, r.reps), is_pr: Boolean(r.is_pr) });
    byId.set(r.session_id, entry);
  }
  const sessions: ExerciseSession[] = [];
  for (const [session_id, { at, sets }] of byId) {
    sets.sort((a, b) => a.set_index - b.set_index);
    let heaviest = { weight_kg: 0, reps: 0 };
    for (const s of sets) {
      if (s.weight_kg > heaviest.weight_kg || (s.weight_kg === heaviest.weight_kg && s.reps > heaviest.reps)) {
        heaviest = { weight_kg: s.weight_kg, reps: s.reps };
      }
    }
    sessions.push({
      session_id,
      at,
      sets,
      best_e1rm: Math.max(0, ...sets.map((s) => s.e1rm)),
      heaviest,
      volume_kg: round1(sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0)),
      max_reps: Math.max(0, ...sets.map((s) => s.reps)),
    });
  }
  return sessions.sort((a, b) => b.at.localeCompare(a.at));
}

export type ExerciseBest = { value: number; at: string } | null;

export type ExerciseStats = {
  sessions: number;
  sets: number;
  /** Σ volume across every session. */
  total_volume_kg: number;
  best_e1rm: ExerciseBest;
  heaviest: { weight_kg: number; reps: number; at: string } | null;
  best_session_volume: ExerciseBest;
  max_reps: ExerciseBest;
  /** True when no set ever carried load: the page leads with reps instead of kilograms. */
  bodyweight: boolean;
};

/** Lifetime bests. The first session to reach a best keeps it — a tie is not a new record. */
export function exerciseSummary(sessions: readonly ExerciseSession[]): ExerciseStats {
  const oldestFirst = [...sessions].sort((a, b) => a.at.localeCompare(b.at));
  let best_e1rm: ExerciseBest = null;
  let best_session_volume: ExerciseBest = null;
  let max_reps: ExerciseBest = null;
  let heaviest: ExerciseStats["heaviest"] = null;
  let sets = 0;
  let total = 0;
  for (const s of oldestFirst) {
    sets += s.sets.length;
    total += s.volume_kg;
    if (s.best_e1rm > 0 && (!best_e1rm || s.best_e1rm > best_e1rm.value)) best_e1rm = { value: s.best_e1rm, at: s.at };
    if (s.volume_kg > 0 && (!best_session_volume || s.volume_kg > best_session_volume.value)) {
      best_session_volume = { value: s.volume_kg, at: s.at };
    }
    if (s.max_reps > 0 && (!max_reps || s.max_reps > max_reps.value)) max_reps = { value: s.max_reps, at: s.at };
    const h = s.heaviest;
    if (h.weight_kg > 0 && (!heaviest || h.weight_kg > heaviest.weight_kg || (h.weight_kg === heaviest.weight_kg && h.reps > heaviest.reps))) {
      heaviest = { ...h, at: s.at };
    }
  }
  return {
    sessions: sessions.length,
    sets,
    total_volume_kg: round1(total),
    best_e1rm,
    heaviest,
    best_session_volume,
    max_reps,
    bodyweight: sessions.length > 0 && sessions.every((s) => s.heaviest.weight_kg === 0),
  };
}

export type RepRecord = { reps: number; weight_kg: number; at: string };

/**
 * The heaviest load ever lifted for at least N reps, for N = 1…maxReps — the
 * "rep records" table. "At least", so the table never claims a 5RM lighter
 * than something done for 6. A row appears only once a set reached that many
 * reps; the date is the first session to set that weight.
 */
export function repRecords(sessions: readonly ExerciseSession[], maxReps = 12): RepRecord[] {
  const oldestFirst = [...sessions].sort((a, b) => a.at.localeCompare(b.at));
  const best = new Map<number, RepRecord>();
  for (const s of oldestFirst) {
    for (const set of s.sets) {
      if (set.weight_kg <= 0) continue;
      for (let n = 1; n <= Math.min(set.reps, maxReps); n++) {
        const current = best.get(n);
        if (!current || set.weight_kg > current.weight_kg) best.set(n, { reps: n, weight_kg: set.weight_kg, at: s.at });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.reps - b.reps);
}

export type ExerciseMetric = "e1rm" | "heaviest" | "volume" | "reps";

/** One point per session, oldest first, for the chart. Sessions with nothing to plot are left out. */
export function exerciseSeries(sessions: readonly ExerciseSession[], metric: ExerciseMetric): { at: string; value: number }[] {
  const pick = (s: ExerciseSession): number =>
    metric === "e1rm" ? s.best_e1rm : metric === "heaviest" ? s.heaviest.weight_kg : metric === "volume" ? s.volume_kg : s.max_reps;
  return [...sessions]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((s) => ({ at: s.at, value: pick(s) }))
    .filter((p) => p.value > 0);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
