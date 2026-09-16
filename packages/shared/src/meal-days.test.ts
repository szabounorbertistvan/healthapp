import { describe, expect, it } from "vitest";
import { isoWeekday, mealsForWeekday } from "./meal-days";

describe("isoWeekday", () => {
  it("counts Monday as 1 and Sunday as 7", () => {
    expect(isoWeekday("2026-09-14")).toBe(1); // Monday
    expect(isoWeekday("2026-09-19")).toBe(6);
    expect(isoWeekday("2026-09-20")).toBe(7); // Sunday
  });
});

const meal = (slot: string, day_index: number, position = 0, name = `${slot}-${day_index}`) =>
  ({ slot, day_index, position, name });

describe("mealsForWeekday", () => {
  it("returns the everyday plan when there is no override", () => {
    const meals = [meal("breakfast", 0), meal("lunch", 0, 1)];
    expect(mealsForWeekday(meals, 3).map((m) => m.name)).toEqual(["breakfast-0", "lunch-0"]);
  });

  it("prefers the day-specific meal over the everyday one", () => {
    const meals = [meal("lunch", 0, 1), meal("lunch", 6, 1, "lunch-saturday")];
    expect(mealsForWeekday(meals, 6).map((m) => m.name)).toEqual(["lunch-saturday"]);
    expect(mealsForWeekday(meals, 2).map((m) => m.name)).toEqual(["lunch-0"]);
  });

  it("ignores overrides written for another day", () => {
    const meals = [meal("dinner", 7, 3, "sunday-roast")];
    expect(mealsForWeekday(meals, 1)).toEqual([]);
  });

  it("keeps one meal per slot and orders by position", () => {
    const meals = [meal("dinner", 0, 3), meal("breakfast", 0, 1), meal("lunch", 0, 2)];
    expect(mealsForWeekday(meals, 4).map((m) => m.slot)).toEqual(["breakfast", "lunch", "dinner"]);
  });

  it("is deterministic when a coach writes two overrides for one slot", () => {
    const meals = [meal("snack", 5, 1, "first"), meal("snack", 5, 2, "second")];
    expect(mealsForWeekday(meals, 5).map((m) => m.name)).toEqual(["first"]);
  });
});
