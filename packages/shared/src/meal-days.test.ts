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

// ---------- per-day totals (the "plan over target" regression) ----------
import { compareToTarget, planDayTotals, planWeekDays, planWeekTotals } from "./meal-days";

const costed = (slot: string, day_index: number, kcal: number, position = 0) => ({
  slot, day_index, position,
  totals: { kcal, protein: kcal / 20, carbs: kcal / 10, fat: kcal / 40 },
});

describe("planDayTotals", () => {
  const base = [costed("breakfast", 0, 500, 0), costed("lunch", 0, 800, 1), costed("dinner", 0, 700, 2)];

  it("sums only the meals a day resolves to — a weekday version replaces, never adds", () => {
    const meals = [...base, costed("lunch", 2, 1000, 1)];
    // The old builder summed every row: 500 + 800 + 700 + 1000 = 3000 kcal.
    expect(planDayTotals(meals, 2).kcal).toBe(2200);
    expect(planDayTotals(meals, 1).kcal).toBe(2000);
  });

  it("changing Tuesday leaves Monday and the rest of the week as they were", () => {
    const before = planWeekDays(base);
    const after = planWeekDays([...base, costed("lunch", 2, 400, 1)]);
    expect(after[1]!.kcal).toBe(1600);
    for (const i of [0, 2, 3, 4, 5, 6]) expect(after[i]).toEqual(before[i]);
  });

  it("an empty version on one day empties that slot on that day only", () => {
    const meals = [...base, costed("dinner", 5, 0, 2)];
    expect(planDayTotals(meals, 5).kcal).toBe(1300);
    expect(planDayTotals(meals, 4).kcal).toBe(2000);
  });

  it("weekday 0 is the base menu alone", () => {
    expect(planDayTotals([...base, costed("lunch", 3, 100, 1)], 0).kcal).toBe(2000);
  });

  it("adds without floating-point drift", () => {
    const meal = (slot: string, protein: number) => ({ slot, day_index: 0, position: 0, totals: { kcal: 100, protein, carbs: 0, fat: 0 } });
    expect(planDayTotals([meal("a", 0.1), meal("b", 0.2)], 1).protein).toBe(0.3);
  });
});

describe("planWeekTotals", () => {
  it("adds the seven days and is a weekly figure, not a daily one", () => {
    const days = planWeekDays([costed("lunch", 0, 600), costed("lunch", 7, 900)]);
    expect(planWeekTotals(days).kcal).toBe(600 * 6 + 900);
  });
});

describe("compareToTarget", () => {
  it("reads within ±5% as on target, on both sides", () => {
    expect(compareToTarget(2100, 2000)).toEqual({ delta: 100, percent: 5, status: "within" });
    expect(compareToTarget(1900, 2000).status).toBe("within");
  });
  it("says above and below with the absolute and relative difference", () => {
    expect(compareToTarget(2300, 2000)).toEqual({ delta: 300, percent: 15, status: "above" });
    expect(compareToTarget(1500, 2000)).toEqual({ delta: -500, percent: -25, status: "below" });
  });
  it("has nothing to compare with a target of 0", () => {
    expect(compareToTarget(120, 0)).toEqual({ delta: 120, percent: null, status: "none" });
  });
});

// ---------- extra meals on one day (20261204100000) ----------
import { nextExtraPosition } from "./meal-days";

describe("extra meals", () => {
  const base = [costed("breakfast", 0, 500, 0), costed("snack", 0, 200, 3)];
  const extra = { ...costed("snack", 2, 300, 100), extra: true };

  it("are added on their own day, next to the slot meal of the same slot", () => {
    const tue = mealsForWeekday([...base, extra], 2);
    expect(tue).toHaveLength(3);
    expect(planDayTotals([...base, extra], 2).kcal).toBe(1000);
  });

  it("appear on no other day and not on the base menu", () => {
    expect(planDayTotals([...base, extra], 1).kcal).toBe(700);
    expect(planDayTotals([...base, extra], 0).kcal).toBe(700);
  });

  it("do not stop a weekday version from replacing its slot meal", () => {
    const version = costed("snack", 2, 50, 3);
    expect(planDayTotals([...base, extra, version], 2).kcal).toBe(500 + 50 + 300);
  });

  it("sort after the base slots and after each other", () => {
    expect(nextExtraPosition([], 2)).toBe(100);
    expect(nextExtraPosition([extra, { day_index: 3, position: 140, extra: true }], 2)).toBe(101);
  });
});
