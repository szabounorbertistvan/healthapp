// Advanced progress — one time range, compared with the range before it,
// across body, strength and consistency.
//
// Nothing here is a new formula. Each number is an aggregation of something
// another module already computes:
//   - per-session training load     training-load.ts (loadOf in the web app)
//   - estimated 1RM                  exercise-analytics.ts relevantOneRm()
//   - which Monday a day belongs to  weekly-series.ts weekStartOf()
//   - the local day of a session     streaks.ts localDay() (the caller's job)
// This module only decides WHICH rows fall in which window and folds them.
//
// Two rules, the same ones exercise analytics keeps:
//   1. Nothing is rounded. A delta of 99.8 − 101.45 stays −1.65000000000001;
//      rounding is a display decision. (weekly-summary's delta() rounds to one
//      decimal because it feeds sentences directly — the reason this file has
//      its own periodChange() rather than reusing it.)
//   2. No comparison is invented. A metric with no value on either side, or a
//      previous window that lies entirely before the person's first record,
//      yields null — and the UI shows nothing rather than "+100 %".
import { relevantOneRm } from "./exercise-analytics";
import type { ExerciseRangeDays } from "./exercise-analytics";
import { weekStartOf } from "./weekly-series";
import { shiftDays } from "./weekly-summary";

/** The same ranges the exercise page offers; null = all time. */
export type ProgressRange = ExerciseRangeDays;

/** Inclusive local days, yyyy-mm-dd. */
export type ProgressWindow = { start: string; end: string };

export type ProgressWindows = {
  current: ProgressWindow;
  /** The equally long window right before `current`; null for all time or with no history that old. */
  previous: ProgressWindow | null;
};

/** Inclusive day count of a window. */
export function windowDays(w: ProgressWindow): number {
  const ms = Date.parse(`${w.end}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function inWindow(day: string, w: ProgressWindow): boolean {
  return day >= w.start && day <= w.end;
}

/**
 * The window `range` days long ending `today`, and the one before it.
 *
 * `earliest` is the first day anything was recorded (a session or a weigh-in).
 * A previous window that ends before it describes a time the person was not
 * using the app, and comparing against it would report every metric as "up
 * from zero" — so there is none.
 */
export function progressWindows(today: string, range: ProgressRange, earliest: string | null): ProgressWindows {
  if (range === null) {
    const start = earliest !== null && earliest < today ? earliest : today;
    return { current: { start, end: today }, previous: null };
  }
  const current = { start: shiftDays(today, -(range - 1)), end: today };
  const previous = { start: shiftDays(today, -(2 * range - 1)), end: shiftDays(today, -range) };
  if (earliest === null || previous.end < earliest) return { current, previous: null };
  return { current, previous };
}

// ---------- change ----------

export type PeriodChange = {
  current: number;
  previous: number;
  /** current − previous, exact. */
  delta: number;
  /** Signed percent of `previous`, exact; null when previous is 0. */
  pct: number | null;
};

/** Current against previous, or null when either side is missing. */
export function periodChange(current: number | null | undefined, previous: number | null | undefined): PeriodChange | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const delta = current - previous;
  return { current, previous, delta, pct: previous === 0 ? null : (delta / Math.abs(previous)) * 100 };
}

// ---------- training ----------

/** One completed session, already scored — what the dashboard read hands in. */
export type ProgressSession = {
  id: string;
  /** Local day (users.timezone) the session started on. */
  day: string;
  /** training-load score of the session, 0..100. */
  load: number;
  /** Sum of weight × reps, exact. */
  volume_kg: number;
  sets: number;
  /** Sets the PR engine flagged. */
  prs: number;
  /** Every set with a library exercise, for strength. */
  lifts: { exercise_id: string; weight_kg: number; reps: number }[];
};

export type PeriodTrainingStats = {
  workouts: number;
  active_days: number;
  volume_kg: number;
  sets: number;
  prs: number;
  /** Sum of per-session load over the window. */
  total_load: number;
  /** Mean per-session load; null when nothing was trained. */
  avg_load: number | null;
  /** Workouts divided by the window's length in weeks. */
  workouts_per_week: number;
};

export function trainingStats(sessions: readonly ProgressSession[], window: ProgressWindow): PeriodTrainingStats {
  const inside = sessions.filter((s) => inWindow(s.day, window));
  const workouts = inside.length;
  const total_load = inside.reduce((sum, s) => sum + finite(s.load), 0);
  return {
    workouts,
    active_days: new Set(inside.map((s) => s.day)).size,
    volume_kg: inside.reduce((sum, s) => sum + finite(s.volume_kg), 0),
    sets: inside.reduce((sum, s) => sum + finite(s.sets), 0),
    prs: inside.reduce((sum, s) => sum + finite(s.prs), 0),
    total_load,
    avg_load: workouts === 0 ? null : total_load / workouts,
    workouts_per_week: workouts / (windowDays(window) / 7),
  };
}

export type TrainingChanges = {
  workouts: PeriodChange | null;
  active_days: PeriodChange | null;
  workouts_per_week: PeriodChange | null;
  volume_kg: PeriodChange | null;
  sets: PeriodChange | null;
  prs: PeriodChange | null;
  total_load: PeriodChange | null;
  avg_load: PeriodChange | null;
};

export type TrainingProgress = {
  current: PeriodTrainingStats;
  previous: PeriodTrainingStats | null;
  changes: TrainingChanges | null;
};

export function trainingProgress(sessions: readonly ProgressSession[], windows: ProgressWindows): TrainingProgress {
  const current = trainingStats(sessions, windows.current);
  if (windows.previous === null) return { current, previous: null, changes: null };
  const previous = trainingStats(sessions, windows.previous);
  return {
    current,
    previous,
    changes: {
      workouts: periodChange(current.workouts, previous.workouts),
      active_days: periodChange(current.active_days, previous.active_days),
      workouts_per_week: periodChange(current.workouts_per_week, previous.workouts_per_week),
      volume_kg: periodChange(current.volume_kg, previous.volume_kg),
      sets: periodChange(current.sets, previous.sets),
      prs: periodChange(current.prs, previous.prs),
      total_load: periodChange(current.total_load, previous.total_load),
      avg_load: periodChange(current.avg_load, previous.avg_load),
    },
  };
}

export type PeriodBucket = { start: string; workouts: number; volume_kg: number; load: number };

/** Longer than this and weekly bars get too thin to read on a phone. */
export const WEEKLY_BUCKET_MAX_DAYS = 180;

/**
 * Sessions per calendar week (Monday start, like every weekly number in the
 * app) or per calendar month for long windows. Empty buckets are kept: a gap
 * in training is the fact a bar chart exists to show.
 */
export function periodBuckets(
  sessions: readonly ProgressSession[],
  window: ProgressWindow,
): { unit: "week" | "month"; items: PeriodBucket[] } {
  const unit = windowDays(window) <= WEEKLY_BUCKET_MAX_DAYS ? "week" : "month";
  const keyOf = unit === "week" ? weekStartOf : (day: string) => `${day.slice(0, 7)}-01`;
  const next = unit === "week" ? (key: string) => shiftDays(key, 7) : nextMonth;

  const items: PeriodBucket[] = [];
  const index = new Map<string, PeriodBucket>();
  const last = keyOf(window.end);
  for (let key = keyOf(window.start); key <= last; key = next(key)) {
    const bucket = { start: key, workouts: 0, volume_kg: 0, load: 0 };
    items.push(bucket);
    index.set(key, bucket);
  }
  for (const s of sessions) {
    if (!inWindow(s.day, window)) continue;
    const bucket = index.get(keyOf(s.day));
    if (!bucket) continue;
    bucket.workouts += 1;
    bucket.volume_kg += finite(s.volume_kg);
    bucket.load += finite(s.load);
  }
  return { unit, items };
}

function nextMonth(key: string): string {
  const [y = 1970, m = 1] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

// ---------- strength ----------

/** Exercises by how many sessions in the window trained them; ties broken by id. */
export function topExercises(
  sessions: readonly ProgressSession[],
  window: ProgressWindow,
): { exercise_id: string; sessions: number }[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (!inWindow(s.day, window)) continue;
    for (const id of new Set(s.lifts.map((l) => l.exercise_id))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts]
    .map(([exercise_id, n]) => ({ exercise_id, sessions: n }))
    .sort((a, b) => b.sessions - a.sessions || a.exercise_id.localeCompare(b.exercise_id));
}

function best1rmIn(sessions: readonly ProgressSession[], window: ProgressWindow): Map<string, number> {
  const best = new Map<string, number>();
  for (const s of sessions) {
    if (!inWindow(s.day, window)) continue;
    for (const lift of s.lifts) {
      const e = relevantOneRm(lift.weight_kg, lift.reps);
      if (e === null) continue;
      const current = best.get(lift.exercise_id);
      if (current === undefined || e > current) best.set(lift.exercise_id, e);
    }
  }
  return best;
}

export type StrengthHighlight = { exercise_id: string; change: PeriodChange };

/**
 * Best estimated 1RM of each lift in this window against the previous one —
 * only for lifts with an estimate on both sides, most-trained first.
 */
export function strengthHighlights(sessions: readonly ProgressSession[], windows: ProgressWindows): StrengthHighlight[] {
  if (windows.previous === null) return [];
  const now = best1rmIn(sessions, windows.current);
  const before = best1rmIn(sessions, windows.previous);
  const out: StrengthHighlight[] = [];
  for (const { exercise_id } of topExercises(sessions, windows.current)) {
    const change = periodChange(now.get(exercise_id), before.get(exercise_id));
    if (change) out.push({ exercise_id, change });
  }
  return out;
}

// ---------- body ----------

export type ProgressMeasurement = {
  day: string;
  weight_kg: number | null;
  /** measurements.circumferences, in cm. */
  circumferences: Record<string, number>;
};

export type BodyPoint = { day: string; value: number };

export type BodyMetric = {
  /** Every value in the current window, oldest first, exactly as stored. */
  series: BodyPoint[];
  /** The newest value ever recorded, in or before the window. */
  latest: BodyPoint | null;
  /** Latest value of the current window against the latest of the previous one. */
  change: PeriodChange | null;
};

export type BodyProgress = {
  weight: BodyMetric;
  /** Every circumference key ever logged, alphabetically. */
  circumferences: Record<string, BodyMetric>;
};

function bodyMetric(points: BodyPoint[], windows: ProgressWindows): BodyMetric {
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const series = sorted.filter((p) => inWindow(p.day, windows.current));
  const latestIn = (w: ProgressWindow | null) =>
    w === null ? null : sorted.filter((p) => inWindow(p.day, w)).at(-1) ?? null;
  const latest = sorted.filter((p) => p.day <= windows.current.end).at(-1) ?? null;
  return {
    series,
    latest,
    change: periodChange(latestIn(windows.current)?.value, latestIn(windows.previous)?.value),
  };
}

export function bodyProgress(measurements: readonly ProgressMeasurement[], windows: ProgressWindows): BodyProgress {
  const weight = measurements
    .filter((m) => typeof m.weight_kg === "number" && Number.isFinite(m.weight_kg))
    .map((m) => ({ day: m.day, value: m.weight_kg as number }));

  const byKey = new Map<string, BodyPoint[]>();
  for (const m of measurements) {
    for (const [key, value] of Object.entries(m.circumferences ?? {})) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const list = byKey.get(key) ?? [];
      list.push({ day: m.day, value });
      byKey.set(key, list);
    }
  }
  const circumferences: Record<string, BodyMetric> = {};
  for (const key of [...byKey.keys()].sort()) circumferences[key] = bodyMetric(byKey.get(key)!, windows);

  return { weight: bodyMetric(weight, windows), circumferences };
}

// ---------- insights ----------

/** A factual observation; the UI turns the key into a sentence. */
export type ProgressInsight =
  | { key: "one_rm_change"; exercise_id: string; pct: number; current: number; previous: number }
  | { key: "volume_change"; pct: number }
  | { key: "load_change"; pct: number }
  | { key: "active_days"; current: number; previous: number }
  | { key: "weight_change"; delta_kg: number }
  | { key: "prs"; count: number };

/** Relative changes under this many percent are not worth a sentence. */
export const MIN_INSIGHT_PCT = 1;
/** Lifts named in insights — the most-trained ones, not the biggest swings. */
export const MAX_LIFT_INSIGHTS = 2;

/**
 * Strictly from the numbers, in a fixed order. Every insight needs its data on
 * both sides of the comparison; with none, the list is empty and the UI says
 * so, rather than filling the space with encouragement.
 */
export function progressInsights(input: {
  training: TrainingProgress;
  strength: readonly StrengthHighlight[];
  body: BodyProgress;
}): ProgressInsight[] {
  const out: ProgressInsight[] = [];
  const significant = (pct: number | null): pct is number => pct !== null && Math.abs(pct) >= MIN_INSIGHT_PCT;

  for (const h of input.strength.slice(0, MAX_LIFT_INSIGHTS)) {
    if (significant(h.change.pct)) {
      out.push({ key: "one_rm_change", exercise_id: h.exercise_id, pct: h.change.pct, current: h.change.current, previous: h.change.previous });
    }
  }

  const { changes, previous, current } = input.training;
  if (changes && previous) {
    // Volume and load compare two periods of training. With no workout in
    // the current one there is nothing on this side to compare — "down 100 %"
    // would be arithmetic, not an observation. The day count below says it.
    const trainedBoth = current.workouts > 0 && previous.workouts > 0;
    if (trainedBoth && previous.volume_kg > 0 && significant(changes.volume_kg?.pct ?? null)) {
      out.push({ key: "volume_change", pct: changes.volume_kg!.pct! });
    }
    if (trainedBoth && previous.total_load > 0 && significant(changes.total_load?.pct ?? null)) {
      out.push({ key: "load_change", pct: changes.total_load!.pct! });
    }
    if (current.active_days + previous.active_days > 0) {
      out.push({ key: "active_days", current: current.active_days, previous: previous.active_days });
    }
  }

  const weight = input.body.weight.change;
  if (weight && weight.delta !== 0) out.push({ key: "weight_change", delta_kg: weight.delta });

  if (current.prs > 0) out.push({ key: "prs", count: current.prs });
  return out;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}
