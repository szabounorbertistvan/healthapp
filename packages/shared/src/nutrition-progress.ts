// Advanced nutrition — daily totals folded into periods, compared with a
// target and with the period before.
//
// Like progress.ts, this adds no formula of its own:
//   - calorie adherence score   adherence.ts macroScore() (coach dashboard,
//                               weekly summary and the adherence engine use it)
//   - macro share of calories   macros.ts splitFromGrams() (the targets editor)
//   - which day counts          weekly-summary's rule: a day with calories
//   - windows and comparisons   progress.ts progressWindows() / periodChange()
// The inputs are per-day totals summed from food_logs, whose macros are
// snapshotted at log time — history does not move when a food row changes.
//
// Rules:
//   1. A day without logs is missing data, never a day of eating zero. It is
//      left out of every average and shows as a gap in a chart.
//   2. Nothing is rounded here; rounding is display.
//   3. No target, no comparison with one. A target of 0 for a macro means the
//      person has no target for it.
import { macroScore } from "./adherence";
import { splitFromGrams, type Macros, type MacroSplit } from "./macros";
import { periodChange, windowDays, type PeriodChange, type ProgressWindow, type ProgressWindows } from "./progress";
import { weekStartOf } from "./weekly-series";
import { previousWeek, shiftDays, weekOf } from "./weekly-summary";

/** One day of food_logs, summed. */
export type NutritionDay = {
  day: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** food_logs rows that day. */
  entries: number;
  /** Distinct meal slots logged that day. */
  meals: number;
};

export type MacroKeyAll = keyof Macros;
export const NUTRITION_KEYS: readonly MacroKeyAll[] = ["kcal", "protein", "carbs", "fat"];

/** A day counts as "on target" within ±10 % of it. */
export const NUTRITION_TARGET_BAND = 0.1;

/** The weekly summary's rule (weekStats): a logged day is a day with calories. */
export function isLoggedDay(d: Pick<NutritionDay, "kcal">): boolean {
  return Number.isFinite(d.kcal) && d.kcal > 0;
}

// ---------- one figure against its target ----------

export type MacroLine = {
  consumed: number;
  target: number | null;
  /** consumed − target. */
  difference: number | null;
  /** consumed ÷ target × 100 — may exceed 100. */
  pct: number | null;
};

function clean(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

function targetOf(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function macroLine(consumed: number, target: number | null | undefined): MacroLine {
  const c = clean(consumed);
  const t = targetOf(target);
  if (t === null) return { consumed: c, target: null, difference: null, pct: null };
  return { consumed: c, target: t, difference: c - t, pct: (c / t) * 100 };
}

export function macroAdherence(consumed: Macros, target: Macros | null): Record<MacroKeyAll, MacroLine> {
  return {
    kcal: macroLine(consumed.kcal, target?.kcal),
    protein: macroLine(consumed.protein, target?.protein),
    carbs: macroLine(consumed.carbs, target?.carbs),
    fat: macroLine(consumed.fat, target?.fat),
  };
}

function hasAnyTarget(target: Macros | null): target is Macros {
  return target !== null && NUTRITION_KEYS.some((k) => targetOf(target[k]) !== null);
}

// ---------- a period ----------

export type NutritionPeriod = {
  window: ProgressWindow;
  window_days: number;
  days_logged: number;
  /** Mean of the logged days; null with none. */
  avg: Macros | null;
  /** The average against the target; null without logged days or a target. */
  adherence: Record<MacroKeyAll, MacroLine> | null;
  /** macroScore() × 100: mean per-day closeness to the calorie target, 0..100. */
  kcal_score: number | null;
  /** Logged days at or above each target. */
  days_reached: Record<MacroKeyAll, number> | null;
  /** Logged days within ±10 % of each target. */
  days_within: Record<MacroKeyAll, number> | null;
  /** By calories; only when at least two days were logged. */
  highest: NutritionDay | null;
  lowest: NutritionDay | null;
};

function inWindow(day: string, w: ProgressWindow): boolean {
  return day >= w.start && day <= w.end;
}

export function nutritionPeriod(days: readonly NutritionDay[], window: ProgressWindow, target: Macros | null): NutritionPeriod {
  const logged = days.filter((d) => inWindow(d.day, window) && isLoggedDay(d));
  const n = logged.length;
  const empty: NutritionPeriod = {
    window, window_days: windowDays(window), days_logged: n, avg: null, adherence: null,
    kcal_score: null, days_reached: null, days_within: null, highest: null, lowest: null,
  };
  if (n === 0) return empty;

  const mean = (k: MacroKeyAll) => logged.reduce((s, d) => s + clean(d[k]), 0) / n;
  const avg: Macros = { kcal: mean("kcal"), protein: mean("protein"), carbs: mean("carbs"), fat: mean("fat") };

  const byKcal = [...logged].sort((a, b) => a.kcal - b.kcal || a.day.localeCompare(b.day));
  const out: NutritionPeriod = {
    ...empty,
    avg,
    highest: n >= 2 ? byKcal[n - 1]! : null,
    lowest: n >= 2 ? byKcal[0]! : null,
  };
  if (!hasAnyTarget(target)) return out;

  const count = (test: (value: number, t: number) => boolean) => {
    const r = {} as Record<MacroKeyAll, number>;
    for (const k of NUTRITION_KEYS) {
      const t = targetOf(target[k]);
      r[k] = t === null ? 0 : logged.filter((d) => test(clean(d[k]), t)).length;
    }
    return r;
  };
  const kcalTarget = targetOf(target.kcal);
  return {
    ...out,
    adherence: macroAdherence(avg, target),
    kcal_score: kcalTarget === null ? null : macroScore(logged, kcalTarget) * 100,
    days_reached: count((v, t) => v >= t),
    days_within: count((v, t) => Math.abs(v - t) <= t * NUTRITION_TARGET_BAND),
  };
}

export type NutritionProgress = {
  current: NutritionPeriod;
  previous: NutritionPeriod | null;
  changes: {
    kcal: PeriodChange | null;
    protein: PeriodChange | null;
    carbs: PeriodChange | null;
    fat: PeriodChange | null;
    days_logged: PeriodChange | null;
  } | null;
};

export function nutritionProgress(days: readonly NutritionDay[], windows: ProgressWindows, target: Macros | null): NutritionProgress {
  const current = nutritionPeriod(days, windows.current, target);
  if (windows.previous === null) return { current, previous: null, changes: null };
  const previous = nutritionPeriod(days, windows.previous, target);
  const avgChange = (k: MacroKeyAll) => periodChange(current.avg?.[k], previous.avg?.[k]);
  return {
    current,
    previous,
    changes: {
      kcal: avgChange("kcal"),
      protein: avgChange("protein"),
      carbs: avgChange("carbs"),
      fat: avgChange("fat"),
      days_logged: periodChange(current.days_logged, previous.days_logged),
    },
  };
}

// ---------- series ----------

export type NutritionBucket = {
  /** First day of the bucket. */
  start: string;
  days_logged: number;
  /** Mean over the bucket's logged days; null when none — a gap, not a zero. */
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

/** Up to a month, a point per day; up to half a year, per week; then per month. */
export const NUTRITION_DAILY_MAX_DAYS = 31;
export const NUTRITION_WEEKLY_MAX_DAYS = 180;

export function nutritionSeries(
  days: readonly NutritionDay[],
  window: ProgressWindow,
): { unit: "day" | "week" | "month"; items: NutritionBucket[] } {
  const length = windowDays(window);
  const unit = length <= NUTRITION_DAILY_MAX_DAYS ? "day" : length <= NUTRITION_WEEKLY_MAX_DAYS ? "week" : "month";
  const keyOf =
    unit === "day" ? (d: string) => d : unit === "week" ? weekStartOf : (d: string) => `${d.slice(0, 7)}-01`;
  const next =
    unit === "day" ? (k: string) => shiftDays(k, 1) : unit === "week" ? (k: string) => shiftDays(k, 7) : nextMonth;

  const groups = new Map<string, NutritionDay[]>();
  const last = keyOf(window.end);
  for (let k = keyOf(window.start); k <= last; k = next(k)) groups.set(k, []);
  for (const d of days) {
    if (!inWindow(d.day, window) || !isLoggedDay(d)) continue;
    groups.get(keyOf(d.day))?.push(d);
  }
  const items: NutritionBucket[] = [];
  for (const [start, list] of groups) {
    const n = list.length;
    const mean = (k: MacroKeyAll) => (n === 0 ? null : list.reduce((s, d) => s + clean(d[k]), 0) / n);
    items.push({ start, days_logged: n, kcal: mean("kcal"), protein: mean("protein"), carbs: mean("carbs"), fat: mean("fat") });
  }
  return { unit, items };
}

function nextMonth(key: string): string {
  const [y = 1970, m = 1] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Share of calories from each macro (whole percentages summing to 100); null with no calories. */
export function macroDistribution(grams: Pick<Macros, "protein" | "carbs" | "fat">): MacroSplit | null {
  if (clean(grams.protein) + clean(grams.carbs) + clean(grams.fat) <= 0) return null;
  return splitFromGrams({ protein: clean(grams.protein), carbs: clean(grams.carbs), fat: clean(grams.fat) });
}

// ---------- the week ----------

/** Monday → today, against the whole week before (weeks start Monday, as everywhere). */
export function weekNutrition(
  days: readonly NutritionDay[],
  today: string,
  target: Macros | null,
): { current: NutritionPeriod; previous: NutritionPeriod } {
  const week = weekOf(today);
  return {
    current: nutritionPeriod(days, { start: week.start, end: today }, target),
    previous: nutritionPeriod(days, previousWeek(week), target),
  };
}

// ---------- insights ----------

export type NutritionInsight =
  | { key: "insufficient_data"; days_logged: number; min: number }
  | { key: "avg_kcal"; value: number }
  | { key: "kcal_vs_target"; pct: number }
  | { key: "avg_protein"; value: number }
  | { key: "protein_reached"; days: number; logged: number }
  | { key: "logging"; days: number; window_days: number }
  | { key: "kcal_change"; pct: number }
  | { key: "protein_change"; pct: number };

/** Fewer logged days than this and an average says more about the gaps than the eating. */
export const MIN_INSIGHT_DAYS = 3;
/** A change against the previous period smaller than this is not reported. */
export const NUTRITION_CHANGE_PCT = 5;

/**
 * Factual sentences about logged food, in a fixed order. Everything is about
 * what was LOGGED — the UI words it that way — and nothing is a verdict.
 */
export function nutritionInsights(p: NutritionProgress): NutritionInsight[] {
  const cur = p.current;
  if (cur.days_logged < MIN_INSIGHT_DAYS || cur.avg === null) {
    return [{ key: "insufficient_data", days_logged: cur.days_logged, min: MIN_INSIGHT_DAYS }];
  }
  const out: NutritionInsight[] = [{ key: "avg_kcal", value: cur.avg.kcal }];
  const kcal = cur.adherence?.kcal;
  if (kcal && kcal.pct !== null) out.push({ key: "kcal_vs_target", pct: kcal.pct - 100 });
  out.push({ key: "avg_protein", value: cur.avg.protein });
  if (cur.adherence?.protein.target != null && cur.days_reached) {
    out.push({ key: "protein_reached", days: cur.days_reached.protein, logged: cur.days_logged });
  }
  out.push({ key: "logging", days: cur.days_logged, window_days: cur.window_days });

  if (p.previous && p.previous.days_logged >= MIN_INSIGHT_DAYS && p.changes) {
    const big = (c: PeriodChange | null) => c !== null && c.pct !== null && Math.abs(c.pct) >= NUTRITION_CHANGE_PCT;
    if (big(p.changes.kcal)) out.push({ key: "kcal_change", pct: p.changes.kcal!.pct! });
    if (big(p.changes.protein)) out.push({ key: "protein_change", pct: p.changes.protein!.pct! });
  }
  return out;
}
