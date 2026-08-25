// Macro arithmetic. Shared so the coach's plan builder (live totals vs target)
// and the client's food log compute identical numbers — PRODUCT_SPEC C1/C2
// requires the two surfaces to agree.

export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

/**
 * Scale per-100g values to a portion. The result is what gets denormalized into
 * food_logs: external food data can change, logged history must not.
 */
export function portionMacros(per100g: Macros, grams: number): Macros {
  const factor = grams / 100;
  return {
    kcal: Math.round(per100g.kcal * factor),
    protein: round1(per100g.protein * factor),
    carbs: round1(per100g.carbs * factor),
    fat: round1(per100g.fat * factor),
  };
}

export function sumMacros(entries: readonly Macros[]): Macros {
  return entries.reduce<Macros>(
    (total, entry) => ({
      kcal: total.kcal + entry.kcal,
      protein: round1(total.protein + entry.protein),
      carbs: round1(total.carbs + entry.carbs),
      fat: round1(total.fat + entry.fat),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
