import { describe, expect, test } from "vitest";
import {
  DEFAULT_MACRO_SPLIT, gramsFromSplit, portionMacros, rebalanceSplit, splitFromGrams, sumMacros,
} from "./macros";

// Foods are stored per 100 g (plan §4, "Nutrition calc rules: per-100g base,
// log-time snapshot"). food_logs keeps the computed values because external
// food data changes and history must not.

const CHICKEN = { kcal: 165, protein: 31, carbs: 0, fat: 3.6 };

describe("portionMacros", () => {
  test("scales per-100g values to the logged gram amount", () => {
    expect(portionMacros(CHICKEN, 200)).toEqual({
      kcal: 330,
      protein: 62,
      carbs: 0,
      fat: 7.2,
    });
  });

  test("rounds kcal to whole numbers and macros to one decimal", () => {
    expect(portionMacros({ kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9 }, 65)).toEqual({
      kcal: 253,
      protein: 11,
      carbs: 43.1,
      fat: 4.5,
    });
  });

  test("returns zeroes for a zero-gram portion", () => {
    expect(portionMacros(CHICKEN, 0)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe("sumMacros", () => {
  test("totals a day of logged foods", () => {
    const day = [
      { kcal: 330, protein: 62, carbs: 0, fat: 7.2 },
      { kcal: 253, protein: 11, carbs: 43.1, fat: 4.5 },
    ];

    expect(sumMacros(day)).toEqual({ kcal: 583, protein: 73, carbs: 43.1, fat: 11.7 });
  });

  test("totals an empty day to zero", () => {
    expect(sumMacros([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe("rebalanceSplit", () => {
  test("keeps the three percentages summing to 100 after any change", () => {
    const start = { protein: 30, carbs: 40, fat: 30 };
    for (const value of [0, 5, 33, 50, 77, 100]) {
      for (const key of ["protein", "carbs", "fat"] as const) {
        const next = rebalanceSplit(start, key, value);
        expect(next.protein + next.carbs + next.fat).toBe(100);
        expect(next[key]).toBe(value);
      }
    }
  });

  test("takes the difference from the other two in proportion", () => {
    // protein 30 → 50: 20 points come out of carbs/fat, which were 40/30,
    // so carbs keeps 4/7 of the remaining 50 and fat 3/7.
    expect(rebalanceSplit({ protein: 30, carbs: 40, fat: 30 }, "protein", 50)).toEqual({
      protein: 50,
      carbs: 29,
      fat: 21,
    });
  });

  test("clamps out-of-range input to 0..100", () => {
    expect(rebalanceSplit({ protein: 30, carbs: 40, fat: 30 }, "fat", 140)).toEqual({
      protein: 0,
      carbs: 0,
      fat: 100,
    });
    expect(rebalanceSplit({ protein: 30, carbs: 40, fat: 30 }, "fat", -5).fat).toBe(0);
  });

  test("shares evenly when the other two were both zero", () => {
    expect(rebalanceSplit({ protein: 100, carbs: 0, fat: 0 }, "protein", 40)).toEqual({
      protein: 40,
      carbs: 30,
      fat: 30,
    });
  });
});

describe("gramsFromSplit", () => {
  test("turns kcal and a split into daily gram targets with 4/4/9", () => {
    expect(gramsFromSplit(2000, { protein: 30, carbs: 40, fat: 30 })).toEqual({
      kcal: 2000,
      protein: 150,
      carbs: 200,
      fat: 67,
    });
  });

  test("never goes negative", () => {
    expect(gramsFromSplit(-100, { protein: 30, carbs: 40, fat: 30 })).toEqual({
      kcal: 0, protein: 0, carbs: 0, fat: 0,
    });
  });
});

describe("splitFromGrams", () => {
  test("recovers the split that produced the grams", () => {
    const grams = gramsFromSplit(1800, { protein: 35, carbs: 40, fat: 25 });
    expect(splitFromGrams(grams)).toEqual({ protein: 35, carbs: 40, fat: 25 });
  });

  test("falls back to the default when there are no grams", () => {
    expect(splitFromGrams({ protein: 0, carbs: 0, fat: 0 })).toEqual(DEFAULT_MACRO_SPLIT);
  });
});
