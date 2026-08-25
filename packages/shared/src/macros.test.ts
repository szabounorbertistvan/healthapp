import { describe, expect, test } from "vitest";
import { portionMacros, sumMacros } from "./macros";

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
