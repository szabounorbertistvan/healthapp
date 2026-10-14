// food_daily_totals() rows → NutritionDay. Split out of nutrition-data.ts
// ("server-only") so the conversion can be tested: numeric sums arrive from
// PostgREST as numbers or strings, and a NaN here would poison every average.
import { NUTRITION_SLOTS, type NutritionDay, type NutritionEntry, type NutritionSlot } from "@healthapp/shared";

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

// ---------- single food_logs rows ----------

/** What the meal and label-nutrient views read per entry. */
export const NUTRITION_ENTRY_SELECT =
  "date, slot, grams, kcal, protein_g, carbs_g, fat_g, food:foods(saturated_fat_100g, sugar_100g, salt_100g)";

export type NutritionEntryRow = {
  date: string;
  slot: string;
  grams: number | string | null;
  kcal: number | string | null;
  protein_g: number | string | null;
  carbs_g: number | string | null;
  fat_g: number | string | null;
  food: {
    saturated_fat_100g: number | string | null;
    sugar_100g: number | string | null;
    salt_100g: number | string | null;
  } | null;
};

const SLOTS = new Set<string>(NUTRITION_SLOTS);

/** A per-100 g value scaled to the logged grams; null — unknown, never 0 — when either is missing. */
function scaled(per100: number | string | null | undefined, grams: number): number | null {
  if (per100 === null || per100 === undefined) return null;
  const v = typeof per100 === "string" ? Number(per100) : per100;
  if (!Number.isFinite(v) || v < 0 || !(grams > 0)) return null;
  return (v * grams) / 100;
}

/**
 * Rows → entries. The macros are the snapshot on the row (what the diary
 * shows); the label nutrients come from the linked food as it is now, because
 * food_logs never stored them. A row without a known slot is dropped rather
 * than filed under a meal it was not logged in.
 */
export function toNutritionEntries(rows: readonly NutritionEntryRow[]): NutritionEntry[] {
  const out: NutritionEntry[] = [];
  for (const r of rows) {
    if (!SLOTS.has(r.slot)) continue;
    const grams = num(r.grams);
    out.push({
      day: r.date,
      slot: r.slot as NutritionSlot,
      kcal: num(r.kcal),
      protein: num(r.protein_g),
      carbs: num(r.carbs_g),
      fat: num(r.fat_g),
      saturated_fat: scaled(r.food?.saturated_fat_100g, grams),
      sugar: scaled(r.food?.sugar_100g, grams),
      salt: scaled(r.food?.salt_100g, grams),
    });
  }
  return out;
}
