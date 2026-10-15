// Personal goals — what counts as progress toward one, computed from the
// person's own rows. Pure: the data layer hands in measurements, completed
// sessions and per-day food totals that it already reads for the Progress
// dashboard; nothing here reads a table, and nothing here is stored. A goal
// row (public.goals, 20261125110000) keeps only what the person *chose* —
// metric, direction, target, start, dates, status — so its progress moves the
// moment a new weigh-in, set or meal lands, with nothing typed twice.
//
// Rules (each one has a test in goals.test.ts):
//   1. Missing data is missing, never zero. No weigh-in → no current weight;
//      a day without food logs is left out, not counted as "0 kcal, off target".
//      The reason travels with the answer so the screen can say what is missing.
//   2. A start value is never invented. The one the person set (prefilled from
//      their latest real value) wins; without it the first real data point on or
//      after the goal's start date is the baseline, labelled as such. Neither →
//      no percentage, only the current value and the distance to the target.
//   3. Direction is explicit. "Lose weight" counts down, "lift heavier" counts up;
//      moving the wrong way is shown as 0 % and "off track", never as progress.
//   4. Percentages stay within 0..100. Past the target the goal is "reached"
//      (100 %); the screen offers to mark it achieved — it is never marked by
//      itself, and a value outside the metric's plausible range is dropped as
//      invalid data before anything is computed from it.
//   5. Reuse, not new formulas: logged days are nutrition-progress's
//      isLoggedDay, "on target" is its ±NUTRITION_TARGET_BAND, weeks start on
//      Monday (weekStartOf), a lift is weight × reps from the same set rows the
//      strength dashboard folds.
import { isLoggedDay, NUTRITION_TARGET_BAND, type NutritionDay } from "./nutrition-progress";
import { weekStartOf } from "./weekly-series";
import { shiftDays } from "./weekly-summary";

// ---------- vocabulary ----------

export const GOAL_METRICS = [
  "body_weight",
  "circumference",
  "lift_weight",
  "weekly_workouts",
  "consistency",
  "kcal_on_target",
  "protein_avg",
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_DIRECTIONS = ["increase", "decrease"] as const;
export type GoalDirection = (typeof GOAL_DIRECTIONS)[number];

export const GOAL_STATUSES = ["active", "achieved", "abandoned"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Circumference keys a goal may follow — keys of measurements.circumferences (cm). */
export const GOAL_MEASURE_KEYS = ["waist", "hips", "chest", "arm", "thigh", "neck"] as const;
export type GoalMeasureKey = (typeof GOAL_MEASURE_KEYS)[number];

/** Canonical unit a metric is stored and computed in; display converts kg/cm to the person's units. */
export type GoalUnit = "kg" | "cm" | "per_week" | "pct" | "g";

export type GoalMetricSpec = {
  unit: GoalUnit;
  /** Plausible range of a target (and of a data point: outside it is invalid data). */
  min: number;
  max: number;
  directions: readonly GoalDirection[];
  /** goals.type — the coarse bucket the column already had. */
  type: "weight" | "strength" | "habit" | "other";
};

export const GOAL_METRIC_SPEC: Record<GoalMetric, GoalMetricSpec> = {
  // the same bounds as measurements.weight_kg's check constraint
  body_weight: { unit: "kg", min: 20, max: 400, directions: ["decrease", "increase"], type: "weight" },
  circumference: { unit: "cm", min: 10, max: 300, directions: ["decrease", "increase"], type: "other" },
  lift_weight: { unit: "kg", min: 0.5, max: 1000, directions: ["increase"], type: "strength" },
  weekly_workouts: { unit: "per_week", min: 0.5, max: 14, directions: ["increase"], type: "habit" },
  consistency: { unit: "pct", min: 1, max: 100, directions: ["increase"], type: "habit" },
  kcal_on_target: { unit: "pct", min: 1, max: 100, directions: ["increase"], type: "habit" },
  protein_avg: { unit: "g", min: 10, max: 500, directions: ["increase", "decrease"], type: "other" },
};

/** Active measurable goals one person may hold at once (mirrored by a trigger in SQL). */
export const MAX_ACTIVE_GOALS = 12;

export function isGoalMetric(x: unknown): x is GoalMetric {
  return typeof x === "string" && (GOAL_METRICS as readonly string[]).includes(x);
}
export function isGoalDirection(x: unknown): x is GoalDirection {
  return typeof x === "string" && (GOAL_DIRECTIONS as readonly string[]).includes(x);
}
export function isGoalStatus(x: unknown): x is GoalStatus {
  return typeof x === "string" && (GOAL_STATUSES as readonly string[]).includes(x);
}
export function isGoalMeasureKey(x: unknown): x is GoalMeasureKey {
  return typeof x === "string" && (GOAL_MEASURE_KEYS as readonly string[]).includes(x);
}

/** Two goals on the same source would answer the same question twice — one active at a time. */
export function goalSourceKey(g: { metric: GoalMetric; exercise_id?: string | null; measure_key?: string | null }): string {
  return `${g.metric}:${g.exercise_id ?? ""}:${g.measure_key ?? ""}`;
}

// ---------- validation ----------

export type GoalErrorCode =
  | "GOAL_METRIC"
  | "GOAL_DIRECTION"
  | "GOAL_TARGET"
  | "GOAL_START"
  | "GOAL_TARGET_VS_START"
  | "GOAL_DATES"
  | "GOAL_DEADLINE_PAST"
  | "GOAL_EXERCISE"
  | "GOAL_MEASURE"
  | "GOAL_DUPLICATE"
  | "GOAL_LIMIT"
  | "GOAL_STATUS";

export type GoalInput = {
  metric: string;
  direction: string;
  target_value: number;
  start_value: number | null;
  start_date: string;
  target_date: string | null;
  exercise_id?: string | null;
  measure_key?: string | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDay(x: unknown): x is string {
  if (typeof x !== "string" || !ISO_DAY.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

/**
 * The first rule a goal breaks, or null. `deadlineFromToday` refuses a
 * deadline already in the past — on creation and when the deadline itself is
 * being changed; an old deadline that simply passed stays valid (the goal
 * shows as overdue instead).
 */
export function validateGoalInput(
  input: GoalInput,
  today: string,
  opts: { deadlineFromToday: boolean } = { deadlineFromToday: true },
): GoalErrorCode | null {
  if (!isGoalMetric(input.metric)) return "GOAL_METRIC";
  const spec = GOAL_METRIC_SPEC[input.metric];
  if (!isGoalDirection(input.direction) || !spec.directions.includes(input.direction)) return "GOAL_DIRECTION";
  if (typeof input.target_value !== "number" || !Number.isFinite(input.target_value)
      || input.target_value < spec.min || input.target_value > spec.max) return "GOAL_TARGET";
  if (input.start_value !== null) {
    // a start may honestly be 0 (no workouts a week yet), never negative or past the range
    if (typeof input.start_value !== "number" || !Number.isFinite(input.start_value)
        || input.start_value < 0 || input.start_value > spec.max) return "GOAL_START";
    if (input.direction === "increase" ? input.target_value <= input.start_value : input.target_value >= input.start_value) {
      return "GOAL_TARGET_VS_START";
    }
  }
  if (!isIsoDay(input.start_date)) return "GOAL_DATES";
  if (input.target_date !== null) {
    if (!isIsoDay(input.target_date) || input.target_date < input.start_date) return "GOAL_DATES";
    if (opts.deadlineFromToday && input.target_date < today) return "GOAL_DEADLINE_PAST";
  }
  if (input.metric === "lift_weight") {
    if (typeof input.exercise_id !== "string" || input.exercise_id === "") return "GOAL_EXERCISE";
  } else if (input.exercise_id) return "GOAL_EXERCISE";
  if (input.metric === "circumference") {
    if (!isGoalMeasureKey(input.measure_key)) return "GOAL_MEASURE";
  } else if (input.measure_key) return "GOAL_MEASURE";
  return null;
}

// ---------- the metric's real values ----------

export type GoalPoint = { day: string; value: number };

/** Why a metric has no current value — shown to the person as what is missing. */
export type GoalMissing =
  | "no_measurements"
  | "no_lift_sets"
  | "no_workouts"
  | "too_little_history"
  | "no_kcal_target"
  | "too_few_logged_days";

export type GoalSeries = {
  /** The value progress is measured with now; null = not enough real data (see `missing`). */
  current: GoalPoint | null;
  /** Real values over time, oldest first, for the chart and for a baseline; may be empty. */
  points: GoalPoint[];
  missing: GoalMissing | null;
};

/** A data point outside the metric's plausible range is invalid data, not a value. */
function plausible(metric: GoalMetric, value: number): boolean {
  const spec = GOAL_METRIC_SPEC[metric];
  // 0 is a real reading for counts and shares (no workouts this month), never for a body or a lift
  const floor = spec.unit === "per_week" || spec.unit === "pct" ? 0 : spec.min;
  return Number.isFinite(value) && value >= floor && value <= spec.max;
}

function seriesOf(metric: GoalMetric, points: GoalPoint[], missing: GoalMissing): GoalSeries {
  const clean = points.filter((p) => plausible(metric, p.value)).sort((a, b) => a.day.localeCompare(b.day));
  const current = clean.at(-1) ?? null;
  return { current, points: clean, missing: current ? null : missing };
}

export type GoalMeasurement = { day: string; weight_kg: number | null; circumferences?: Record<string, number> | null };

/** Body weight or one circumference, one point per weigh-in day that recorded it. */
export function measurementSeries(rows: readonly GoalMeasurement[], metric: "body_weight" | "circumference", key?: string | null): GoalSeries {
  const points: GoalPoint[] = [];
  for (const r of rows) {
    const v = metric === "body_weight" ? r.weight_kg : key ? r.circumferences?.[key] : undefined;
    if (typeof v === "number") points.push({ day: r.day, value: Number(v) });
  }
  return seriesOf(metric, points, "no_measurements");
}

export type GoalSession = { day: string; lifts: readonly { exercise_id: string; weight_kg: number; reps: number }[] };

/** The heaviest weight moved for at least one rep of one exercise, per training day. */
export function liftSeries(sessions: readonly GoalSession[], exerciseId: string): GoalSeries {
  const best = new Map<string, number>();
  for (const s of sessions) {
    for (const l of s.lifts) {
      if (l.exercise_id !== exerciseId || !(l.reps > 0) || !(l.weight_kg > 0)) continue;
      best.set(s.day, Math.max(best.get(s.day) ?? 0, l.weight_kg));
    }
  }
  return seriesOf("lift_weight", [...best].map(([day, value]) => ({ day, value })), "no_lift_sets");
}

/** Weeks the rolling workout average looks back over. */
export const WORKOUT_AVG_WEEKS = 4;
/** Completed weeks shown on a frequency/consistency chart. */
export const GOAL_CHART_WEEKS = 12;
/** Completed weeks the consistency share is taken over, and the fewest it needs. */
export const CONSISTENCY_WEEKS = 8;
export const CONSISTENCY_MIN_WEEKS = 2;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Workouts per completed Monday week from `firstWeek` up to the week before `today`'s, at most `limit` of them. */
function completedWeekCounts(sessionDays: readonly string[], today: string, firstDay: string, limit: number): GoalPoint[] {
  const thisWeek = weekStartOf(today);
  const firstWeek = weekStartOf(firstDay);
  const counts = new Map<string, number>();
  for (const d of sessionDays) {
    const w = weekStartOf(d);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const weeks: GoalPoint[] = [];
  for (let w = shiftDays(thisWeek, -7); w >= firstWeek && weeks.length < limit; w = shiftDays(w, -7)) {
    weeks.push({ day: w, value: counts.get(w) ?? 0 });
  }
  return weeks.reverse();
}

/**
 * Workouts a week: the completed sessions of the last four weeks (28 days
 * ending today) divided by four — or by the weeks since the very first
 * session, for someone who started less than four weeks ago, so a new account
 * is not averaged against weeks before it existed. With no session ever there
 * is nothing to average: missing, not 0.
 */
export function weeklyWorkoutsSeries(sessionDays: readonly string[], today: string, firstDay: string | null): GoalSeries {
  if (!firstDay || sessionDays.length === 0) return { current: null, points: [], missing: "no_workouts" };
  const from = shiftDays(today, -(WORKOUT_AVG_WEEKS * 7 - 1));
  const recent = sessionDays.filter((d) => d >= from && d <= today).length;
  const weeksSinceFirst = Math.ceil((daysBetween(firstDay, today) + 1) / 7);
  const weeks = Math.min(WORKOUT_AVG_WEEKS, Math.max(1, weeksSinceFirst));
  const value = Math.round((recent / weeks) * 10) / 10;
  return {
    current: { day: today, value },
    points: completedWeekCounts(sessionDays, today, firstDay, GOAL_CHART_WEEKS),
    missing: null,
  };
}

/**
 * Consistency: the share of the last eight completed weeks with at least one
 * workout, counting only weeks since the first session ever. Fewer than two
 * such weeks is too little history to call anything consistent.
 */
export function consistencySeries(sessionDays: readonly string[], today: string, firstDay: string | null): GoalSeries {
  if (!firstDay || sessionDays.length === 0) return { current: null, points: [], missing: "no_workouts" };
  const weeks = completedWeekCounts(sessionDays, today, firstDay, CONSISTENCY_WEEKS);
  if (weeks.length < CONSISTENCY_MIN_WEEKS) return { current: null, points: [], missing: "too_little_history" };
  const active = weeks.filter((w) => w.value > 0).length;
  return {
    current: { day: today, value: Math.round((active / weeks.length) * 100) },
    // the chart shows each week trained (100) or not (0)
    points: weeks.map((w) => ({ day: w.day, value: w.value > 0 ? 100 : 0 })),
    missing: null,
  };
}

/** Days of food logs a nutrition goal looks back over (today excluded — it is still being eaten). */
export const NUTRITION_GOAL_DAYS = 14;
/** Logged days a nutrition figure needs before it means anything (nutrition-progress's MIN_INSIGHT_DAYS). */
export const NUTRITION_GOAL_MIN_DAYS = 3;

function nutritionWindow(days: readonly NutritionDay[], today: string): NutritionDay[] {
  const from = shiftDays(today, -NUTRITION_GOAL_DAYS);
  return days.filter((d) => d.day >= from && d.day < today && isLoggedDay(d));
}

/**
 * Share of logged days within ±10 % of the calorie target, over the last two
 * weeks before today. No target → nothing to be on; under three logged days →
 * too little to say. Unlogged days are left out (rule 1).
 */
export function kcalOnTargetSeries(days: readonly NutritionDay[], kcalTarget: number | null, today: string): GoalSeries {
  if (!kcalTarget || !(kcalTarget > 0)) return { current: null, points: [], missing: "no_kcal_target" };
  const logged = nutritionWindow(days, today);
  if (logged.length < NUTRITION_GOAL_MIN_DAYS) return { current: null, points: [], missing: "too_few_logged_days" };
  const on = logged.filter((d) => Math.abs(d.kcal - kcalTarget) <= kcalTarget * NUTRITION_TARGET_BAND).length;
  return {
    current: { day: shiftDays(today, -1), value: Math.round((on / logged.length) * 100) },
    points: logged.map((d) => ({ day: d.day, value: Math.abs(d.kcal - kcalTarget) <= kcalTarget * NUTRITION_TARGET_BAND ? 100 : 0 })),
    missing: null,
  };
}

/** Average daily protein over the logged days of the last two weeks before today. */
export function proteinAvgSeries(days: readonly NutritionDay[], today: string): GoalSeries {
  const logged = nutritionWindow(days, today);
  if (logged.length < NUTRITION_GOAL_MIN_DAYS) return { current: null, points: [], missing: "too_few_logged_days" };
  const avg = logged.reduce((sum, d) => sum + d.protein, 0) / logged.length;
  return {
    current: { day: shiftDays(today, -1), value: Math.round(avg) },
    points: logged.map((d) => ({ day: d.day, value: Math.round(d.protein) })),
    missing: null,
  };
}

// ---------- progress toward the target ----------

export type GoalForProgress = {
  metric: GoalMetric;
  direction: GoalDirection;
  target_value: number;
  start_value: number | null;
  start_date: string;
  target_date: string | null;
  status: GoalStatus;
};

export type GoalProgressState =
  /** no current value — `missing` says why */
  | "no_data"
  /** a current value, but no start to measure progress from */
  | "no_baseline"
  | "in_progress"
  /** moving away from the target since the start */
  | "off_track"
  /** the latest real value meets the target — awaiting the person's "achieved" */
  | "reached";

export type GoalProgress = {
  state: GoalProgressState;
  current: GoalPoint | null;
  baseline: number | null;
  /** "set" = the start the person saved; "first_record" = their first real value since the start date. */
  baselineFrom: "set" | "first_record" | null;
  /** 0..100, null when there is no baseline or no current value. */
  pct: number | null;
  /** current − baseline, signed in the metric's unit; null without both. */
  change: number | null;
  /** How far the current value still is from the target, ≥ 0; 0 once reached. */
  remaining: number | null;
  /** Days from today to the deadline (negative once past); null without one. */
  daysLeft: number | null;
  /** Active, past its deadline and not reached. */
  overdue: boolean;
  missing: GoalMissing | null;
};

function meets(direction: GoalDirection, value: number, target: number): boolean {
  return direction === "increase" ? value >= target : value <= target;
}

export function goalProgress(goal: GoalForProgress, series: GoalSeries, today: string): GoalProgress {
  const current = series.current;
  const daysLeft = goal.target_date ? daysBetween(today, goal.target_date) : null;

  let baseline: number | null = null;
  let baselineFrom: GoalProgress["baselineFrom"] = null;
  if (goal.start_value !== null && Number.isFinite(goal.start_value)) {
    baseline = goal.start_value;
    baselineFrom = "set";
  } else {
    const first = series.points.find((p) => p.day >= goal.start_date);
    if (first) {
      baseline = first.value;
      baselineFrom = "first_record";
    }
  }

  const reachedNow = current !== null && meets(goal.direction, current.value, goal.target_value);
  const overdue = goal.status === "active" && daysLeft !== null && daysLeft < 0 && !reachedNow;
  const base = { current, baseline, baselineFrom, daysLeft, overdue, missing: current ? null : series.missing };

  if (!current) return { ...base, state: "no_data", pct: null, change: null, remaining: null };

  const remaining = reachedNow ? 0 : Math.abs(goal.target_value - current.value);
  if (reachedNow) {
    return { ...base, state: "reached", pct: 100, change: baseline === null ? null : current.value - baseline, remaining };
  }
  if (baseline === null) return { ...base, state: "no_baseline", pct: null, change: null, remaining };

  const change = current.value - baseline;
  const distance = goal.target_value - baseline;
  // A first record already past the target with the current value back on the
  // wrong side, or a zero distance: nothing honest to divide by.
  const towardTarget = goal.direction === "increase" ? distance > 0 : distance < 0;
  if (!towardTarget) return { ...base, state: "in_progress", pct: null, change, remaining };

  const raw = (change / distance) * 100;
  if (raw < 0) return { ...base, state: "off_track", pct: 0, change, remaining };
  return { ...base, state: "in_progress", pct: Math.min(100, Math.max(0, Math.round(raw))), change, remaining };
}
