import "server-only";
import type { FoodItemV1 } from "@healthapp/api/v1";
import type { FoodItem } from "@/lib/food-portions";

/** The web's FoodItem on the /api/v1 contract. */
export function foodItem(f: FoodItem): FoodItemV1 {
  return {
    id: f.id,
    name_en: f.name_en,
    name_ro: f.name_ro,
    brand: f.brand ?? null,
    per_100g: f.per_100g,
    portions: (f.portions ?? []).map((p) => ({ label: p.label, grams: p.grams, note: p.note ?? "" })),
    english_only: Boolean(f.english_only),
  };
}
