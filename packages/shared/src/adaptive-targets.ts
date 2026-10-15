// Adaptive calorie targets: what the person really burns, read off what they
// ate and what the scale did over the last four weeks — energy balance, not a
// formula from age and height. If the diary says 2,300 kcal a day and the
// weight trend fell 0.3 kg a week, maintenance is about 2,300 + 0.3 × 7,700 / 7.
//
// Two honesty rules. It says nothing until there is enough data (a weight
// trend needs weigh-ins spread over time, an intake needs logged days), and it
// throws away days that are obviously half-logged, because an under-reported
// diary makes maintenance look lower than it is — the classic way this kind of
// estimate talks someone into eating too little.
import { shiftDays } from "./weekly-summary";

/** Kilocalories in a kilogram of body-weight change — the usual approximation. */
export const KCAL_PER_KG = 7700;
/** The window the estimate reads. */
export const ADAPTIVE_WINDOW_DAYS = 28;
export const MIN_LOGGED_DAYS = 10;
export const MIN_WEIGH_INS = 4;
/** First to last weigh-in must span at least this many days, or the slope is noise. */
export const MIN_WEIGH_SPAN_DAYS = 10;
/** A day under this share of the median logged day is taken as half-logged and skipped. */
export const PARTIAL_DAY_SHARE = 0.5;
/** Never suggest less than this, whatever the arithmetic says. */
export const MIN_SUGGESTED_KCAL = 1200;
/** A deficit is capped at this share of maintenance. */
export const MAX_DEFICIT_SHARE = 0.25;
/** Estimates outside this band mean the inputs are wrong, not the person. */
const PLAUSIBLE_TDEE = { min: 1000, max: 6000 };

export type AdaptiveGoal = "lose" | "maintain" | "gain";
/** Weekly change per goal, as a share of body weight. */
export const GOAL_WEEKLY_RATE: Record<AdaptiveGoal, number> = { lose: -0.005, maintain: 0, gain: 0.0025 };

export type AdaptiveEstimate =
  | {
      status: "ok";
      /** Estimated maintenance, kcal/day, rounded to 10. */
      tdee: number;
      /** Mean intake over the days counted, kcal/day. */
      avg_intake: number;
      /** Trend change, kg/week (negative = losing). */
      weekly_change_kg: number;
      /** The trend line's weight at the last weigh-in, kg. */
      trend_weight_kg: number;
      logged_days: number;
      weigh_ins: number;
      /** A daily target for each goal, kcal, rounded to 10. */
      targets: Record<AdaptiveGoal, number>;
    }
  | { status: "not_enough"; logged_days: number; weigh_ins: number; weigh_span_days: number }
  | { status: "implausible"; tdee: number };

function dayNumber(day: string): number {
  const [y = 1970, m = 1, d = 1] = day.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

/** Least-squares slope (kg/day) and the fitted value at the last x. */
function trend(points: { x: number; y: number }[]): { slope: number; last: number } {
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const lastX = Math.max(...points.map((p) => p.x));
  return { slope, last: my + slope * (lastX - mx) };
}

/**
 * The daily target for a goal, from maintenance and body weight: the goal's
 * weekly rate turned into kcal/day, a deficit capped at MAX_DEFICIT_SHARE of
 * maintenance, never under MIN_SUGGESTED_KCAL.
 */
export function targetForGoal(tdee: number, weightKg: number, goal: AdaptiveGoal): number {
  const daily = (GOAL_WEEKLY_RATE[goal] * weightKg * KCAL_PER_KG) / 7;
  const capped = Math.max(daily, -tdee * MAX_DEFICIT_SHARE);
  return Math.max(MIN_SUGGESTED_KCAL, round10(tdee + capped));
}

/**
 * The estimate over the ADAPTIVE_WINDOW_DAYS ending `today` (inclusive).
 * `days` are diary totals (any order, zero-kcal days ignored); `weights` are
 * weigh-ins (several on one day are averaged).
 */
export function adaptiveEstimate(input: {
  today: string;
  days: readonly { day: string; kcal: number }[];
  weights: readonly { day: string; weight_kg: number }[];
}): AdaptiveEstimate {
  const start = shiftDays(input.today, -(ADAPTIVE_WINDOW_DAYS - 1));
  const inWindow = (d: string) => d >= start && d <= input.today;

  const logged = input.days.filter((d) => inWindow(d.day) && d.kcal > 0);
  const floor = logged.length > 0 ? median(logged.map((d) => d.kcal)) * PARTIAL_DAY_SHARE : 0;
  const counted = logged.filter((d) => d.kcal >= floor);

  const byDay = new Map<string, number[]>();
  for (const w of input.weights) {
    if (!inWindow(w.day) || !(w.weight_kg > 0)) continue;
    byDay.set(w.day, [...(byDay.get(w.day) ?? []), w.weight_kg]);
  }
  const points = [...byDay].map(([day, ws]) => ({ x: dayNumber(day), y: ws.reduce((a, b) => a + b, 0) / ws.length }));
  const span = points.length > 1 ? Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) : 0;

  if (counted.length < MIN_LOGGED_DAYS || points.length < MIN_WEIGH_INS || span < MIN_WEIGH_SPAN_DAYS) {
    return { status: "not_enough", logged_days: counted.length, weigh_ins: points.length, weigh_span_days: span };
  }

  const avg = counted.reduce((a, d) => a + d.kcal, 0) / counted.length;
  const { slope, last } = trend(points);
  const tdee = round10(avg - slope * KCAL_PER_KG);
  if (tdee < PLAUSIBLE_TDEE.min || tdee > PLAUSIBLE_TDEE.max) return { status: "implausible", tdee };

  return {
    status: "ok",
    tdee,
    avg_intake: Math.round(avg),
    weekly_change_kg: Math.round(slope * 7 * 100) / 100,
    trend_weight_kg: Math.round(last * 10) / 10,
    logged_days: counted.length,
    weigh_ins: points.length,
    targets: {
      lose: targetForGoal(tdee, last, "lose"),
      maintain: targetForGoal(tdee, last, "maintain"),
      gain: targetForGoal(tdee, last, "gain"),
    },
  };
}
