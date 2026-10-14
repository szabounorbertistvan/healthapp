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
import { longestRun } from "./achievements";
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
  /**
   * Days of the window the diary could have been kept: from the first day
   * anything was ever logged (or the window start, whichever is later) to the
   * window end. A window reaching back before someone started is not "empty".
   */
  tracked_days: number;
  /** tracked_days − days_logged: no data, never zero calories. */
  unlogged_days: number;
  /** Logged days with at most PARTIAL_DAY_MAX_MEALS meal slot — likely incomplete. Today is never one: it is still going. */
  partial_days: number;
  /** Longest run of consecutive logged days inside the window. */
  longest_run: number;
};

/** Context a period needs to tell "not started yet" and "still today" from missing data. */
export type NutritionContext = { firstDay?: string | null; today?: string | null };

/** A logged day with this many meal slots or fewer is counted as possibly incomplete. */
export const PARTIAL_DAY_MAX_MEALS = 1;

function inWindow(day: string, w: ProgressWindow): boolean {
  return day >= w.start && day <= w.end;
}

/** Days of `window` from `firstDay` on; the whole window without one, 0 when it ends before it. */
export function trackedDays(window: ProgressWindow, firstDay: string | null | undefined): number {
  if (!firstDay || firstDay <= window.start) return windowDays(window);
  if (firstDay > window.end) return 0;
  return windowDays({ start: firstDay, end: window.end });
}

export function nutritionPeriod(
  days: readonly NutritionDay[],
  window: ProgressWindow,
  target: Macros | null,
  context: NutritionContext = {},
): NutritionPeriod {
  const logged = days.filter((d) => inWindow(d.day, window) && isLoggedDay(d));
  const n = logged.length;
  const tracked = Math.max(trackedDays(window, context.firstDay), n);
  const empty: NutritionPeriod = {
    window, window_days: windowDays(window), days_logged: n, avg: null, adherence: null,
    kcal_score: null, days_reached: null, days_within: null, highest: null, lowest: null,
    tracked_days: tracked,
    unlogged_days: tracked - n,
    partial_days: logged.filter((d) => d.day !== context.today && d.meals <= PARTIAL_DAY_MAX_MEALS).length,
    longest_run: longestRun(logged.map((d) => d.day)),
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
    partial_days: PeriodChange | null;
  } | null;
};

export function nutritionProgress(
  days: readonly NutritionDay[],
  windows: ProgressWindows,
  target: Macros | null,
  context: NutritionContext = {},
): NutritionProgress {
  const current = nutritionPeriod(days, windows.current, target, context);
  if (windows.previous === null) return { current, previous: null, changes: null };
  const previous = nutritionPeriod(days, windows.previous, target, context);
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
      partial_days: periodChange(current.partial_days, previous.partial_days),
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
  // out of the days the diary could have been kept — not days before the first log
  out.push({ key: "logging", days: cur.days_logged, window_days: cur.tracked_days });

  if (p.previous && p.previous.days_logged >= MIN_INSIGHT_DAYS && p.changes) {
    const big = (c: PeriodChange | null) => c !== null && c.pct !== null && Math.abs(c.pct) >= NUTRITION_CHANGE_PCT;
    if (big(p.changes.kcal)) out.push({ key: "kcal_change", pct: p.changes.kcal!.pct! });
    if (big(p.changes.protein)) out.push({ key: "protein_change", pct: p.changes.protein!.pct! });
  }
  return out;
}

// ---------- single entries: meals and label nutrients ----------

/** The diary's meal slots (the meal_slot enum), in the diary's order. */
export const NUTRITION_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type NutritionSlot = (typeof NUTRITION_SLOTS)[number];

/** Label nutrients the food library can carry (20261019100000) — the only ones it has. */
export const LABEL_NUTRIENTS = ["saturated_fat", "sugar", "salt"] as const;
export type LabelNutrient = (typeof LABEL_NUTRIENTS)[number];

/**
 * One food_logs row. The four macros are the snapshot taken when it was
 * logged; the label nutrients are NOT snapshotted (food_logs has no column for
 * them) — they are the linked food's per-100 g value × grams today, and null
 * when the food has no value for it or the entry has no food link.
 */
export type NutritionEntry = {
  day: string;
  slot: NutritionSlot;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  saturated_fat: number | null;
  sugar: number | null;
  salt: number | null;
};

/** Logged days of a window, by the same rule as the day totals: the day's entries add up to some calories. */
function loggedEntries(entries: readonly NutritionEntry[], window: ProgressWindow): { list: NutritionEntry[]; days: Set<string> } {
  const kcalByDay = new Map<string, number>();
  for (const e of entries) {
    if (!inWindow(e.day, window)) continue;
    kcalByDay.set(e.day, (kcalByDay.get(e.day) ?? 0) + clean(e.kcal));
  }
  const days = new Set([...kcalByDay].filter(([, kcal]) => kcal > 0).map(([d]) => d));
  return { list: entries.filter((e) => days.has(e.day)), days };
}

export type SlotStats = {
  /** Logged days on which this slot has at least one entry. */
  days: number;
  /** Logged days without it — not "skipped", only not logged. */
  days_missing: number;
  /** Share of the window's logged calories, 0..100; null with no calories at all. */
  kcal_share: number | null;
  /** Mean per day the slot WAS logged; null when it never was. */
  avg: Macros | null;
};

export type MealDistribution = { logged_days: number; slots: Record<NutritionSlot, SlotStats> };

/**
 * How the logged food spreads over the diary's four slots. Averages are per
 * day the slot was logged, so a breakfast nobody wrote down does not drag
 * "breakfast" towards zero; how often it was missing is its own number.
 */
export function mealDistribution(entries: readonly NutritionEntry[], window: ProgressWindow): MealDistribution {
  const { list, days } = loggedEntries(entries, window);
  const totalKcal = list.reduce((s, e) => s + clean(e.kcal), 0);
  const slots = {} as Record<NutritionSlot, SlotStats>;
  for (const slot of NUTRITION_SLOTS) {
    const mine = list.filter((e) => e.slot === slot);
    const slotDays = new Set(mine.map((e) => e.day)).size;
    const sum = (k: keyof Macros) => mine.reduce((s, e) => s + clean(e[k]), 0);
    slots[slot] = {
      days: slotDays,
      days_missing: days.size - slotDays,
      kcal_share: totalKcal > 0 ? (sum("kcal") / totalKcal) * 100 : null,
      avg: slotDays === 0 ? null : {
        kcal: sum("kcal") / slotDays,
        protein: sum("protein") / slotDays,
        carbs: sum("carbs") / slotDays,
        fat: sum("fat") / slotDays,
      },
    };
  }
  return { logged_days: days.size, slots };
}

/** Below this share of logged calories carrying a value, a nutrient's average is not shown as one. */
export const LABEL_COVERAGE_MIN = 90;

/**
 * EU reference intakes for an average adult (8400 kJ / 2000 kcal), Regulation
 * (EU) No 1169/2011, Annex XIII Part B — the figures behind "% RI" on a food
 * label. A general labelling reference, not a personal target or a limit.
 */
export const EU_REFERENCE_INTAKE_G: Record<LabelNutrient, number> = { saturated_fat: 20, sugar: 90, salt: 6 };

export type LabelNutrientStats = {
  /** Sum of the entries that HAVE a value — a floor when coverage is incomplete. */
  known_total: number;
  /** known_total ÷ logged days; null with no logged day. */
  avg_known: number | null;
  /** Share of logged calories from entries with a value, 0..100; null with no calories. */
  coverage_pct: number | null;
  /** coverage_pct ≥ LABEL_COVERAGE_MIN: the average can be read as one. */
  complete: boolean;
};

export type LabelNutrientPeriod = { logged_days: number; nutrients: Record<LabelNutrient, LabelNutrientStats> };

/**
 * Saturated fat, sugar and salt over the logged days. A food without a value
 * is unknown, not zero: it lowers the coverage and leaves the total a floor.
 * Coverage is weighted by calories, so a glass of water with no sugar figure
 * does not make a week look incomplete.
 */
export function labelNutrients(entries: readonly NutritionEntry[], window: ProgressWindow): LabelNutrientPeriod {
  const { list, days } = loggedEntries(entries, window);
  const totalKcal = list.reduce((s, e) => s + clean(e.kcal), 0);
  const nutrients = {} as Record<LabelNutrient, LabelNutrientStats>;
  for (const key of LABEL_NUTRIENTS) {
    const known = list.filter((e) => typeof e[key] === "number" && Number.isFinite(e[key]));
    const known_total = known.reduce((s, e) => s + Math.max(0, e[key] as number), 0);
    const knownKcal = known.reduce((s, e) => s + clean(e.kcal), 0);
    const coverage_pct = totalKcal > 0 ? (knownKcal / totalKcal) * 100 : null;
    nutrients[key] = {
      known_total,
      avg_known: days.size === 0 ? null : known_total / days.size,
      coverage_pct,
      complete: coverage_pct !== null && coverage_pct >= LABEL_COVERAGE_MIN,
    };
  }
  return { logged_days: days.size, nutrients };
}

/** This period's average against the previous one — only when both are complete enough to be averages. */
export function labelNutrientChange(
  current: LabelNutrientStats,
  previous: LabelNutrientStats | null | undefined,
): PeriodChange | null {
  if (!previous || !current.complete || !previous.complete) return null;
  return periodChange(current.avg_known, previous.avg_known);
}
