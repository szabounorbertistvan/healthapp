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
  "date, slot, grams, kcal, protein_g, carbs_g, fat_g, saturated_fat_g, sugar_g, salt_g";

export type NutritionEntryRow = {
  date: string;
  slot: string;
  grams: number | string | null;
  kcal: number | string | null;
  protein_g: number | string | null;
  carbs_g: number | string | null;
  fat_g: number | string | null;
  /** Grams in this entry, snapshotted at log time (20261126100000); null = not measured. */
  saturated_fat_g: number | string | null;
  sugar_g: number | string | null;
  salt_g: number | string | null;
};

const SLOTS = new Set<string>(NUTRITION_SLOTS);

/** A snapshotted amount; null — unknown, never 0 — when it was not measured. */
function known(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Rows → entries. The macros and the label nutrients are both the snapshot on
 * the row, taken when the entry was logged — editing a food never rewrites a
 * past day. A row without a known slot is dropped rather than filed under a
 * meal it was not logged in.
 */
export function toNutritionEntries(rows: readonly NutritionEntryRow[]): NutritionEntry[] {
  const out: NutritionEntry[] = [];
  for (const r of rows) {
    if (!SLOTS.has(r.slot)) continue;
    out.push({
      day: r.date,
      slot: r.slot as NutritionSlot,
      kcal: num(r.kcal),
      protein: num(r.protein_g),
      carbs: num(r.carbs_g),
      fat: num(r.fat_g),
      saturated_fat: known(r.saturated_fat_g),
      sugar: known(r.sugar_g),
      salt: known(r.salt_g),
    });
  }
  return out;
}
