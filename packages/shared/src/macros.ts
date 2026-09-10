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

// ---------- calorie targets from a percentage split ----------

/** kcal per gram, the Atwater factors every calorie label is built on. */
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

export type MacroKey = "protein" | "carbs" | "fat";

/** Percentage of daily calories from each macro. Always sums to 100. */
export type MacroSplit = Record<MacroKey, number>;

export const MACRO_KEYS: readonly MacroKey[] = ["protein", "carbs", "fat"];

/** A common starting point: 30% protein, 40% carbs, 30% fat. */
export const DEFAULT_MACRO_SPLIT: MacroSplit = { protein: 30, carbs: 40, fat: 30 };

/**
 * Move one macro to a new percentage and take the difference out of (or give it
 * to) the other two in proportion to their current share, so the three always
 * total 100 and the person never has to do the subtraction themselves. Values
 * are whole percentages; any rounding remainder lands on the larger of the two
 * untouched macros, so 100 is exact rather than approximate.
 */
export function rebalanceSplit(split: MacroSplit, changed: MacroKey, value: number): MacroSplit {
  const next = Math.round(Math.min(Math.max(value, 0), 100));
  const others = MACRO_KEYS.filter((k) => k !== changed) as [MacroKey, MacroKey];
  const remaining = 100 - next;
  const currentOthers = split[others[0]] + split[others[1]];

  let first: number;
  if (currentOthers <= 0) {
    // Both others were at zero: nothing to scale, so share the remainder evenly.
    first = Math.round(remaining / 2);
  } else {
    first = Math.round((split[others[0]] / currentOthers) * remaining);
  }
  const second = remaining - first;
  const result = { ...split, [changed]: next } as MacroSplit;
  result[others[0]] = first;
  result[others[1]] = second;
  return result;
}

/** Daily gram targets for a calorie goal and a percentage split. */
export function gramsFromSplit(kcal: number, split: MacroSplit): Macros {
  const safeKcal = Math.max(0, kcal);
  return {
    kcal: Math.round(safeKcal),
    protein: Math.round((safeKcal * split.protein) / 100 / KCAL_PER_GRAM.protein),
    carbs: Math.round((safeKcal * split.carbs) / 100 / KCAL_PER_GRAM.carbs),
    fat: Math.round((safeKcal * split.fat) / 100 / KCAL_PER_GRAM.fat),
  };
}

/**
 * The reverse: the percentage split a set of gram targets implies. Lets a plan
 * saved as grams open the editor on the right sliders. Returns the default split
 * when the grams carry no calories at all.
 */
export function splitFromGrams(target: Pick<Macros, "protein" | "carbs" | "fat">): MacroSplit {
  const kcalP = Math.max(0, target.protein) * KCAL_PER_GRAM.protein;
  const kcalC = Math.max(0, target.carbs) * KCAL_PER_GRAM.carbs;
  const kcalF = Math.max(0, target.fat) * KCAL_PER_GRAM.fat;
  const total = kcalP + kcalC + kcalF;
  if (total <= 0) return { ...DEFAULT_MACRO_SPLIT };
  const protein = Math.round((kcalP / total) * 100);
  const carbs = Math.round((kcalC / total) * 100);
  return { protein, carbs, fat: 100 - protein - carbs };
}
