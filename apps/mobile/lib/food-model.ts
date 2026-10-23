import type { FoodDayV1, FoodItemV1, MacrosV1, MealSlotV1 } from "@healthapp/api/v1";
import { MEAL_SLOTS_V1 } from "@healthapp/api/v1";
import { portionMacros } from "@healthapp/shared";
import type { QueuedFood } from "./outbox-core";

// What the food diary shows: the server's entries plus the logs still waiting
// on the phone, and the day's totals over both. Pure, tested in food-model.test.ts.
// The macro arithmetic is @healthapp/shared's portionMacros — the same rounding
// logFood() snapshots, so a pending entry shows what the server will store.

export type DiaryEntry = {
  /** The server's food_logs id; null while the log is only on the phone. */
  id: string | null;
  localId: string | null;
  slot: MealSlotV1;
  food_name: string;
  grams: number;
  macros: MacrosV1;
  state: "synced" | "pending" | "refused";
  error?: string | null;
};

const ZERO: MacrosV1 = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function diary(day: FoodDayV1, queued: readonly QueuedFood[]): Record<MealSlotV1, DiaryEntry[]> {
  const out = Object.fromEntries(MEAL_SLOTS_V1.map((s) => [s, [] as DiaryEntry[]])) as Record<MealSlotV1, DiaryEntry[]>;
  for (const e of day.entries) {
    out[e.slot].push({ id: e.id, localId: null, slot: e.slot, food_name: e.food_name, grams: e.grams, macros: e.macros, state: "synced" });
  }
  for (const q of queued) {
    if (q.input.day !== day.day) continue;
    out[q.input.slot].push({
      id: null,
      localId: q.id,
      slot: q.input.slot,
      food_name: q.input.foodName,
      grams: q.input.grams,
      macros: portionMacros(q.input.per100g, q.input.grams),
      state: q.error ? "refused" : "pending",
      error: q.error ?? null,
    });
  }
  return out;
}

/**
 * The day's totals: the server's, plus what is still waiting on the phone.
 * A log the outbox delivered is in the server's totals once the day is re-read,
 * and it leaves the outbox in the same flush — never counted twice for long.
 */
export function totalsWithPending(day: FoodDayV1, queued: readonly QueuedFood[]): MacrosV1 {
  const pending = queued.filter((q) => q.input.day === day.day && !q.error);
  return pending.reduce<MacrosV1>((sum, q) => {
    const m = portionMacros(q.input.per100g, q.input.grams);
    return { kcal: sum.kcal + m.kcal, protein: sum.protein + m.protein, carbs: sum.carbs + m.carbs, fat: sum.fat + m.fat };
  }, { ...ZERO, ...day.totals });
}

export function sumMacros(list: readonly { macros: MacrosV1 }[]): MacrosV1 {
  return list.reduce<MacrosV1>(
    (s, e) => ({ kcal: s.kcal + e.macros.kcal, protein: s.protein + e.macros.protein, carbs: s.carbs + e.macros.carbs, fat: s.fat + e.macros.fat }),
    { ...ZERO },
  );
}

/** The name in the reader's language: a USDA row without a Romanian name keeps its English one. */
export function foodName(f: Pick<FoodItemV1, "name_en" | "name_ro">, locale: "ro" | "en"): string {
  return locale === "ro" ? f.name_ro || f.name_en : f.name_en || f.name_ro;
}

/** The day before / after an ISO day, by the calendar (no time zone involved). */
export function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
