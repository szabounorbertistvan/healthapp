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
  /** training-load sessionDurationMin(): null when the session was not plausibly timed. */
  duration_min?: number | null;
  /** Logged against a program day (planned), as opposed to an ad-hoc workout. */
  from_program?: boolean;
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
  /** Calendar weeks (Monday start) the window touches, partial ones included. */
  weeks: number;
  /** Of those, the weeks with at least one workout. */
  active_weeks: number;
  /** Workouts logged against a program day; the rest were ad hoc. */
  from_program: number;
  /** Sessions with a plausible duration — the median below is over these only. */
  timed: number;
  /** Median minutes of the timed sessions; null when none was timed. */
  median_minutes: number | null;
};

export function trainingStats(sessions: readonly ProgressSession[], window: ProgressWindow): PeriodTrainingStats {
  const inside = sessions.filter((s) => inWindow(s.day, window));
  const workouts = inside.length;
  const total_load = inside.reduce((sum, s) => sum + finite(s.load), 0);
  const minutes = inside
    .map((s) => s.duration_min)
    .filter((m): m is number => typeof m === "number" && Number.isFinite(m))
    .sort((a, b) => a - b);
  return {
    workouts,
    active_days: new Set(inside.map((s) => s.day)).size,
    volume_kg: inside.reduce((sum, s) => sum + finite(s.volume_kg), 0),
    sets: inside.reduce((sum, s) => sum + finite(s.sets), 0),
    prs: inside.reduce((sum, s) => sum + finite(s.prs), 0),
    total_load,
    avg_load: workouts === 0 ? null : total_load / workouts,
    workouts_per_week: workouts / (windowDays(window) / 7),
    weeks: weeksIn(window),
    active_weeks: new Set(inside.map((s) => weekStartOf(s.day))).size,
    from_program: inside.filter((s) => s.from_program === true).length,
    timed: minutes.length,
    median_minutes: median(minutes),
  };
}

/** Calendar weeks (Monday start) a window touches. */
export function weeksIn(window: ProgressWindow): number {
  const first = weekStartOf(window.start);
  const last = weekStartOf(window.end);
  // windowDays is inclusive: Monday to the next Monday is 8 days, one week apart
  return (windowDays({ start: first, end: last }) - 1) / 7 + 1;
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type TrainingChanges = {
  workouts: PeriodChange | null;
  active_days: PeriodChange | null;
  workouts_per_week: PeriodChange | null;
  active_weeks: PeriodChange | null;
  median_minutes: PeriodChange | null;
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
      active_weeks: periodChange(current.active_weeks, previous.active_weeks),
      median_minutes: periodChange(current.median_minutes, previous.median_minutes),
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
  /**
   * The last value inside the current window against the first one inside it
   * — "since the start of the period". Null with fewer than two records in
   * the window: one record is a value, not a change.
   */
  within: PeriodChange | null;
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
  const first = series[0];
  const last = series.at(-1);
  return {
    series,
    latest,
    change: periodChange(latestIn(windows.current)?.value, latestIn(windows.previous)?.value),
    within: first && last && first.day !== last.day ? periodChange(last.value, first.value) : null,
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

/** One metric on two chosen dates. */
export type MeasurementDelta = { key: "weight" | string; from: number; to: number; change: PeriodChange };

export type MeasurementComparison = {
  from: string;
  to: string;
  /** Weight first, then circumferences alphabetically — only metrics recorded on BOTH dates. */
  deltas: MeasurementDelta[];
  /** Metrics recorded on only one of the two dates: named, never compared against a zero. */
  oneSided: string[];
};

/**
 * Two weigh-in dates side by side. Only days that have a measurement row are
 * valid; a metric missing on either day is listed as one-sided instead of
 * being compared with nothing. Null when either day has no row or they are
 * the same day.
 */
export function compareMeasurements(
  measurements: readonly ProgressMeasurement[],
  from: string,
  to: string,
): MeasurementComparison | null {
  if (from === to) return null;
  const [a, b] = from < to ? [from, to] : [to, from];
  // the newest row of a day wins, as it would on the chart
  const rowOf = (day: string) => measurements.filter((m) => m.day === day).at(-1);
  const ra = rowOf(a);
  const rb = rowOf(b);
  if (!ra || !rb) return null;
  const valueOf = (m: ProgressMeasurement, key: string): number | null => {
    const v = key === "weight" ? m.weight_kg : (m.circumferences ?? {})[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const keys = [
    "weight",
    ...[...new Set([...Object.keys(ra.circumferences ?? {}), ...Object.keys(rb.circumferences ?? {})])].sort(),
  ];
  const deltas: MeasurementDelta[] = [];
  const oneSided: string[] = [];
  for (const key of keys) {
    const va = valueOf(ra, key);
    const vb = valueOf(rb, key);
    if (va === null && vb === null) continue;
    const change = periodChange(vb, va);
    if (change === null) oneSided.push(key);
    else deltas.push({ key, from: va as number, to: vb as number, change });
  }
  return { from: a, to: b, deltas, oneSided };
}

// ---------- one lift, two periods ----------

/** What the lift comparison reads per session — ExerciseSessionEntry already has it. */
export type LiftSession = {
  /** Local day of the session. */
  day: string;
  top_weight_kg: number;
  top_reps: number;
  volume_kg: number;
  best_1rm: number | null;
};

export type LiftPeriod = {
  sessions: number;
  best_weight_kg: number | null;
  best_reps: number | null;
  best_1rm: number | null;
  volume_kg: number;
  /** Day of the newest session in the period. */
  last_day: string | null;
};

export type LiftComparison = {
  current: LiftPeriod;
  previous: LiftPeriod | null;
  best_weight_kg: PeriodChange | null;
  best_reps: PeriodChange | null;
  best_1rm: PeriodChange | null;
  volume_kg: PeriodChange | null;
  /**
   * The two periods were trained differently — loaded in one, bodyweight
   * only in the other — so weights are not compared, only reps.
   */
  mixed: boolean;
};

function liftPeriod(sessions: readonly LiftSession[], window: ProgressWindow): LiftPeriod {
  const inside = sessions.filter((s) => inWindow(s.day, window));
  const loaded = inside.filter((s) => s.top_weight_kg > 0);
  const best = (xs: number[]) => (xs.length === 0 ? null : Math.max(...xs));
  const oneRms = inside.map((s) => s.best_1rm).filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    sessions: inside.length,
    best_weight_kg: best(loaded.map((s) => s.top_weight_kg)),
    best_reps: best(inside.map((s) => s.top_reps).filter((r) => r > 0)),
    best_1rm: best(oneRms),
    volume_kg: inside.reduce((sum, s) => sum + finite(s.volume_kg), 0),
    last_day: inside.map((s) => s.day).sort().at(-1) ?? null,
  };
}

/**
 * The selected lift in this period against the previous one. Every figure is
 * compared only when it exists on both sides; a period with no session of the
 * lift compares nothing. Weights are not compared across a bodyweight period
 * and a loaded one — different exercises in practice.
 */
export function liftComparison(sessions: readonly LiftSession[], windows: ProgressWindows): LiftComparison {
  const current = liftPeriod(sessions, windows.current);
  const previous = windows.previous ? liftPeriod(sessions, windows.previous) : null;
  const both = previous !== null && previous.sessions > 0 && current.sessions > 0;
  const mixed = both && (current.best_weight_kg === null) !== (previous!.best_weight_kg === null);
  return {
    current,
    previous,
    best_weight_kg: both && !mixed ? periodChange(current.best_weight_kg, previous!.best_weight_kg) : null,
    best_reps: both ? periodChange(current.best_reps, previous!.best_reps) : null,
    best_1rm: both && !mixed ? periodChange(current.best_1rm, previous!.best_1rm) : null,
    volume_kg: both && !mixed && previous!.volume_kg > 0 ? periodChange(current.volume_kg, previous!.volume_kg) : null,
    mixed,
  };
}

// ---------- insights ----------

/** A factual observation; the UI turns the key into a sentence. */
export type ProgressInsight =
  | { key: "one_rm_change"; exercise_id: string; pct: number; current: number; previous: number }
  | { key: "volume_change"; pct: number }
  | { key: "load_change"; pct: number }
  | { key: "active_days"; current: number; previous: number }
  | { key: "week_workouts"; current: number; previous: number }
  /** within = first to last weigh-in of this period; previous = against the previous period's last. */
  | { key: "weight_change"; delta_kg: number; basis: "within" | "previous" }
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
  /** This calendar week against the last one (calendarWeekWorkouts); left out where it would repeat the period. */
  week?: { current: number; previous: number } | null;
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

  if (input.week && input.week.current + input.week.previous > 0) {
    out.push({ key: "week_workouts", current: input.week.current, previous: input.week.previous });
  }

  // Within the period when it holds two weigh-ins, else against the period before.
  const within = input.body.weight.within;
  const across = input.body.weight.change;
  if (within && within.delta !== 0) out.push({ key: "weight_change", delta_kg: within.delta, basis: "within" });
  else if (!within && across && across.delta !== 0) out.push({ key: "weight_change", delta_kg: across.delta, basis: "previous" });

  if (current.prs > 0) out.push({ key: "prs", count: current.prs });
  return out;
}

/** Workouts in the calendar week (Monday start) holding `today`, and in the week before. */
export function calendarWeekWorkouts(sessions: readonly ProgressSession[], today: string): { current: number; previous: number } {
  const monday = weekStartOf(today);
  const lastMonday = shiftDays(monday, -7);
  let current = 0;
  let previous = 0;
  for (const s of sessions) {
    if (s.day > today) continue;
    const week = weekStartOf(s.day);
    if (week === monday) current += 1;
    else if (week === lastMonday) previous += 1;
  }
  return { current, previous };
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}
