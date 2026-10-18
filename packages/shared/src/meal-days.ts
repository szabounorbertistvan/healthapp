// Which planned meals apply on a given weekday.
//
// planned_meals.day_index has meant "0 = every day, 1..7 = specific weekday"
// since the first nutrition migration, but nothing ever wrote anything but 0,
// so every client saw the same four meals on a Monday and on a Sunday. This is
// the rule that makes the column real, and it lives here because the client
// app, the coach's preview and "ate as planned" must all resolve it the same
// way — a plan that shows one thing and logs another is worse than no plan.
//
// Weekdays are ISO: 1 = Monday … 7 = Sunday. Postgres `extract(isodow …)`
// agrees, which matters because the reminder jobs already speak that dialect.

/** ISO weekday (1 = Monday … 7 = Sunday) for a Date or yyyy-mm-dd string. */
export function isoWeekday(day: Date | string): number {
  const d = typeof day === "string" ? new Date(`${day.slice(0, 10)}T00:00:00Z`) : day;
  const dow = typeof day === "string" ? d.getUTCDay() : d.getDay();
  return dow === 0 ? 7 : dow;
}

/**
 * The meals that apply on `weekday`, one per slot: a meal written for that
 * exact day wins over the everyday default, and slots with neither are absent.
 *
 * Ordering within a slot follows `position`, so a coach who adds two overrides
 * for the same slot and day gets the first one — deterministic rather than
 * whichever row the database happened to return.
 *
 * An `extra` meal (20261204100000) is added on its own day on top of the slot
 * meals — never replacing one, never replaced — and is absent on every other
 * day. Extras are always day-specific, so the base menu (weekday 0) has none.
 */
export function mealsForWeekday<T extends { slot: string; day_index: number; position?: number; extra?: boolean | null }>(
  meals: readonly T[],
  weekday: number,
): T[] {
  const bySlot = new Map<string, T>();
  const extras: T[] = [];
  const ordered = [...meals].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const meal of ordered) {
    if (meal.extra) {
      if (weekday !== 0 && meal.day_index === weekday) extras.push(meal);
      continue;
    }
    if (meal.day_index !== 0 && meal.day_index !== weekday) continue;
    const current = bySlot.get(meal.slot);
    // A day-specific meal replaces the everyday one; a second meal of the same
    // specificity does not replace the first.
    if (!current || (current.day_index === 0 && meal.day_index === weekday)) {
      bySlot.set(meal.slot, meal);
    }
  }
  return [...bySlot.values(), ...extras].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** At most this many extra meals on one day of a plan — planned_meals_guard's cap. */
export const MAX_EXTRA_MEALS_PER_DAY = 4;

/** Where a new extra meal sorts: after the base slots (positions 0..3) and the day's other extras. */
export function nextExtraPosition(meals: readonly { day_index: number; position?: number; extra?: boolean | null }[], weekday: number): number {
  const taken = meals.filter((m) => m.extra && m.day_index === weekday).map((m) => m.position ?? 0);
  return Math.max(99, ...taken) + 1;
}

// ---------- per-day totals and the target comparison ----------
//
// A plan's meals are one list holding the everyday defaults (day_index 0) and
// the weekday versions (1..7). Summing that list counts a slot twice on any day
// that has its own version — which is how the builder came to show a plan "over
// target" as soon as a coach wrote one different Tuesday lunch. A day's total is
// the sum of the meals that day actually resolves to, and nothing else.

type MacroTotals = { kcal: number; protein: number; carbs: number; fat: number };

const ZERO_TOTALS: MacroTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * What one day of the plan adds up to: the meals `mealsForWeekday` resolves for
 * `weekday`, summed. `weekday` 0 is the everyday baseline — the defaults alone,
 * which is what any day without a version of its own eats.
 */
export function planDayTotals<T extends { slot: string; day_index: number; position?: number; totals: MacroTotals }>(
  meals: readonly T[],
  weekday: number,
): MacroTotals {
  return mealsForWeekday(meals, weekday).reduce<MacroTotals>(
    (sum, m) => ({
      kcal: r1(sum.kcal + m.totals.kcal),
      protein: r1(sum.protein + m.totals.protein),
      carbs: r1(sum.carbs + m.totals.carbs),
      fat: r1(sum.fat + m.totals.fat),
    }),
    ZERO_TOTALS,
  );
}

/** Monday..Sunday, each day's totals; index 0 is Monday (ISO weekday 1). */
export function planWeekDays<T extends { slot: string; day_index: number; position?: number; totals: MacroTotals }>(
  meals: readonly T[],
): MacroTotals[] {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => planDayTotals(meals, d));
}

/** The seven days added up — a weekly figure, never to be compared with a daily target. */
export function planWeekTotals(days: readonly MacroTotals[]): MacroTotals {
  return days.reduce<MacroTotals>(
    (sum, d) => ({
      kcal: r1(sum.kcal + d.kcal),
      protein: r1(sum.protein + d.protein),
      carbs: r1(sum.carbs + d.carbs),
      fat: r1(sum.fat + d.fat),
    }),
    ZERO_TOTALS,
  );
}

/** How close a day lands to its target counts as on target: the builder's long-standing 5%. */
export const PLAN_TARGET_TOLERANCE = 0.05;

export type TargetStatus = "below" | "within" | "above" | "none";

export type TargetComparison = {
  /** actual − target, rounded to 0.1. */
  delta: number;
  /** delta as a percentage of the target, rounded to a whole percent; null without a target. */
  percent: number | null;
  /** "none" when there is no target to compare against (0 means not set). */
  status: TargetStatus;
};

/** One number against its daily target, with the same tolerance on both sides. */
export function compareToTarget(actual: number, target: number, tolerance = PLAN_TARGET_TOLERANCE): TargetComparison {
  const delta = r1(actual - target);
  if (!(target > 0)) return { delta, percent: null, status: "none" };
  const ratio = (actual - target) / target;
  return {
    delta,
    percent: Math.round(ratio * 100),
    status: Math.abs(ratio) <= tolerance ? "within" : ratio > 0 ? "above" : "below",
  };
}
