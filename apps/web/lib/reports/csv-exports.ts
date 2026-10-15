// The CSV exports, one file per kind of data — never one ambiguous sheet.
//
//   workouts           one row per logged set of a completed workout in the period
//   exercise-progress  one row per exercise per completed workout (working sets only)
//   body               one row per weigh-in day; a column per circumference recorded
//   nutrition          one row per food diary entry
//   goals              one row per measurable goal alive during the period
//
// Every header names its unit. Dates are the person's local days (YYYY-MM-DD) in
// their time zone, which the file name and the first column header state. Missing
// values are empty cells. No internal ids, no other person's data: the rows come
// from the caller's own reads (lib/reports/report-data.ts) and carry only what the
// columns below list.
import { GOAL_METRIC_SPEC, sessionPerformance, type GoalMetric, type LengthUnit, type WeightUnit } from "@healthapp/shared";
import type { GoalView } from "../goals-data";
import type { ReportMeasurement, ReportPeriod, ReportSession } from "./report-model";
import type { CsvCell } from "./csv";

export const CSV_KINDS = ["workouts", "exercise-progress", "body", "nutrition", "goals"] as const;
export type CsvKind = (typeof CSV_KINDS)[number];

export function isCsvKind(x: unknown): x is CsvKind {
  return typeof x === "string" && (CSV_KINDS as readonly string[]).includes(x);
}

export type CsvTable = { headers: string[]; rows: CsvCell[][] };

export type CsvUnits = { weight: WeightUnit; length: LengthUnit };

const LB_PER_KG = 2.2046226218487757;
const CM_PER_IN = 2.54;

/** Exact in kg/cm; converted (to 2 decimals) only for a reader who uses lb/in. */
export function weightOut(kg: number | null | undefined, unit: WeightUnit): number | null {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return null;
  return unit === "kg" ? kg : Math.round(kg * LB_PER_KG * 100) / 100;
}
export function lengthOut(cm: number | null | undefined, unit: LengthUnit): number | null {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return null;
  return unit === "cm" ? cm : Math.round((cm / CM_PER_IN) * 100) / 100;
}

/** The header strings every builder needs; lib/i18n supplies them in the reader's language. */
export type CsvStrings = {
  yes: string;
  no: string;
  date: string;
  time: string;
  workout: string;
  exercise: string;
  set: string;
  weight: string;
  reps: string;
  duration: string;
  rpe: string;
  rir: string;
  warmup: string;
  pr: string;
  workingSets: string;
  topWeight: string;
  repsAtTop: string;
  best1rm: string;
  volume: string;
  bodyWeight: string;
  slot: string;
  food: string;
  grams: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  goal: string;
  metric: string;
  direction: string;
  start: string;
  target: string;
  current: string;
  unit: string;
  progress: string;
  status: string;
  startDate: string;
  deadline: string;
  closedDate: string;
  slots: Record<string, string>;
  metrics: Record<GoalMetric, string>;
  directions: { increase: string; decrease: string };
  statuses: { active: string; achieved: string; abandoned: string };
  measureKeys: Record<string, string>;
  perWeek: string;
};

function withUnit(label: string, unit: string): string {
  return `${label} (${unit})`;
}

function inPeriod(day: string, p: ReportPeriod): boolean {
  return day >= p.from && day <= p.to;
}

/** HH:MM of an instant on the person's clock. */
export function localTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

export function workoutsCsv(sessions: readonly ReportSession[], period: ReportPeriod, s: CsvStrings, u: CsvUnits, timeZone: string): CsvTable {
  const headers = [
    withUnit(s.date, timeZone), withUnit(s.time, timeZone), s.workout, s.exercise, s.set,
    withUnit(s.weight, u.weight), s.reps, withUnit(s.duration, "s"), s.rpe, s.rir, s.warmup, s.pr,
  ];
  const rows: CsvCell[][] = [];
  for (const ses of [...sessions].filter((x) => inPeriod(x.day, period)).sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const time = localTime(ses.started_at, timeZone);
    for (const x of [...ses.sets].sort((a, b) => a.set_index - b.set_index)) {
      rows.push([
        ses.day, time, ses.name, x.exercise_name, x.set_index,
        x.weight_kg > 0 ? weightOut(x.weight_kg, u.weight) : x.reps > 0 ? 0 : null,
        x.reps > 0 ? x.reps : null,
        x.duration_seconds, x.rpe, x.rir,
        x.warmup ? s.yes : s.no, x.is_pr ? s.yes : s.no,
      ]);
    }
  }
  return { headers, rows };
}

export function exerciseProgressCsv(sessions: readonly ReportSession[], period: ReportPeriod, s: CsvStrings, u: CsvUnits, timeZone: string): CsvTable {
  const headers = [
    withUnit(s.date, timeZone), s.exercise, s.workingSets, withUnit(s.topWeight, u.weight), s.repsAtTop,
    withUnit(s.best1rm, u.weight), withUnit(s.volume, u.weight),
  ];
  const rows: CsvCell[][] = [];
  for (const ses of [...sessions].filter((x) => inPeriod(x.day, period)).sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const groups = new Map<string, { name: string; sets: ReportSession["sets"] }>();
    for (const x of ses.sets) {
      if (!x.exercise_id) continue;
      const g = groups.get(x.exercise_id) ?? { name: x.exercise_name, sets: [] };
      g.sets.push(x);
      groups.set(x.exercise_id, g);
    }
    for (const g of groups.values()) {
      const p = sessionPerformance({ session_id: ses.id, day: ses.day, sets: g.sets });
      if (p.working_sets === 0) continue;
      rows.push([
        ses.day, g.name, p.working_sets,
        p.top_weight_kg > 0 ? weightOut(p.top_weight_kg, u.weight) : null,
        p.reps_at_top_weight || null,
        p.best_1rm === null ? null : weightOut(Math.round(p.best_1rm * 10) / 10, u.weight),
        p.volume_kg > 0 ? weightOut(p.volume_kg, u.weight) : null,
      ]);
    }
  }
  return { headers, rows };
}

export function bodyCsv(measurements: readonly ReportMeasurement[], period: ReportPeriod, s: CsvStrings, u: CsvUnits, timeZone: string): CsvTable {
  const rows = measurements.filter((m) => inPeriod(m.day, period)).sort((a, b) => a.day.localeCompare(b.day));
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.circumferences)))].sort();
  const headers = [
    withUnit(s.date, timeZone), withUnit(s.bodyWeight, u.weight),
    ...keys.map((k) => withUnit(s.measureKeys[k] ?? k, u.length)),
  ];
  return {
    headers,
    rows: rows.map((r) => [r.day, weightOut(r.weight_kg, u.weight), ...keys.map((k) => lengthOut(r.circumferences[k], u.length))]),
  };
}

export type FoodRow = { day: string; slot: string; food_name: string; grams: number | null; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };

export function nutritionCsv(foods: readonly FoodRow[], period: ReportPeriod, s: CsvStrings, timeZone: string): CsvTable {
  const headers = [
    withUnit(s.date, timeZone), s.slot, s.food, withUnit(s.grams, "g"), withUnit(s.kcal, "kcal"),
    withUnit(s.protein, "g"), withUnit(s.carbs, "g"), withUnit(s.fat, "g"),
  ];
  const order = ["breakfast", "lunch", "dinner", "snack"];
  const rows = foods
    .filter((f) => inPeriod(f.day, period))
    .sort((a, b) => a.day.localeCompare(b.day) || order.indexOf(a.slot) - order.indexOf(b.slot));
  return {
    headers,
    rows: rows.map((f) => [f.day, s.slots[f.slot] ?? f.slot, f.food_name, f.grams, f.kcal, f.protein, f.carbs, f.fat]),
  };
}

/** A goal's value in the reader's unit, and the unit's label. */
function goalValue(metric: GoalMetric, v: number | null, u: CsvUnits): number | null {
  if (v === null) return null;
  const unit = GOAL_METRIC_SPEC[metric].unit;
  return unit === "kg" ? weightOut(v, u.weight) : unit === "cm" ? lengthOut(v, u.length) : v;
}
function goalUnit(metric: GoalMetric, s: CsvStrings, u: CsvUnits): string {
  const unit = GOAL_METRIC_SPEC[metric].unit;
  return unit === "kg" ? u.weight : unit === "cm" ? u.length : unit === "per_week" ? s.perWeek : unit === "pct" ? "%" : "g";
}

/** Goals alive during the period: started by its end, and not closed before it began. */
export function goalsCsv(goals: readonly GoalView[], period: ReportPeriod, s: CsvStrings, u: CsvUnits, timeZone: string): CsvTable {
  const headers = [
    s.goal, s.metric, s.direction, s.start, s.target, s.current, s.unit, withUnit(s.progress, "%"),
    s.status, withUnit(s.startDate, timeZone), withUnit(s.deadline, timeZone), withUnit(s.closedDate, timeZone),
  ];
  const closedDay = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : null);
  const rows = goals
    .filter((g) => g.start_date <= period.to && (g.closed_at === null || (closedDay(g.closed_at) ?? "") >= period.from))
    .map((g) => {
      const label = [s.metrics[g.metric], g.exercise_name, g.measure_key ? (s.measureKeys[g.measure_key] ?? g.measure_key) : null].filter(Boolean).join(" · ");
      return [
        g.title, label, s.directions[g.direction],
        goalValue(g.metric, g.progress.baseline, u), goalValue(g.metric, g.target_value, u),
        goalValue(g.metric, g.progress.current?.value ?? null, u),
        goalUnit(g.metric, s, u), g.progress.pct, s.statuses[g.status],
        g.start_date, g.target_date, closedDay(g.closed_at),
      ] as CsvCell[];
    });
  return { headers, rows };
}
