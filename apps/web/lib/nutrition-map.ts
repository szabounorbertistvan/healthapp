// food_daily_totals() rows → NutritionDay. Split out of nutrition-data.ts
// ("server-only") so the conversion can be tested: numeric sums arrive from
// PostgREST as numbers or strings, and a NaN here would poison every average.
import type { NutritionDay } from "@healthapp/shared";

export type DailyTotalRow = {
  day: string;
  kcal: number | string | null;
  protein: number | string | null;
  carbs: number | string | null;
  fat: number | string | null;
  entries: number;
  meals: number;
};

function num(v: number | string | null): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Oldest first — charts read left to right. */
export function toNutritionDays(rows: readonly DailyTotalRow[]): NutritionDay[] {
  return rows
    .map((r) => ({
      day: r.day,
      kcal: num(r.kcal),
      protein: num(r.protein),
      carbs: num(r.carbs),
      fat: num(r.fat),
      entries: r.entries,
      meals: r.meals,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
