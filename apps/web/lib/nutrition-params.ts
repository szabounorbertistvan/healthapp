// /food keeps its view in the URL, like /progress: the diary (default, with
// its own ?day=) or trends with a range and one chart at a time. Pure, so the
// parser guarding the query can be tested.
import type { ProgressRange } from "@healthapp/shared";

export type FoodView = "diary" | "trends";
export type NutritionChart = "kcal" | "protein" | "macros";
export const NUTRITION_CHARTS: readonly NutritionChart[] = ["kcal", "protein", "macros"];

export type FoodState = { view: FoodView; range: ProgressRange; chart: NutritionChart };

const DEFAULT: FoodState = { view: "diary", range: 30, chart: "kcal" };
const RANGES: Record<string, ProgressRange> = { "7": 7, "30": 30, "90": 90, "365": 365, all: null };

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseFoodParams(raw: Raw): FoodState {
  const view = first(raw.view);
  const range = first(raw.range);
  const chart = first(raw.chart);
  return {
    view: view === "trends" ? "trends" : DEFAULT.view,
    range: range !== undefined && range in RANGES ? RANGES[range]! : DEFAULT.range,
    chart: NUTRITION_CHARTS.includes(chart as NutritionChart) ? (chart as NutritionChart) : DEFAULT.chart,
  };
}

/** The diary is plain /food; trends carries only what differs from the defaults. */
export function foodHref(state: FoodState): string {
  if (state.view === "diary") return "/food";
  const q = new URLSearchParams({ view: "trends" });
  if (state.range !== DEFAULT.range) q.set("range", state.range === null ? "all" : String(state.range));
  if (state.chart !== DEFAULT.chart) q.set("chart", state.chart);
  return `/food?${q.toString()}`;
}
