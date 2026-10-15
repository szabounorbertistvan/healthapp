import { describe, expect, it } from "vitest";
import { toNutritionDays, toNutritionEntries, type NutritionEntryRow } from "./nutrition-map";
import { foodHref, parseFoodParams } from "./nutrition-params";

describe("toNutritionDays", () => {
  it("turns numeric columns (which PostgREST may send as strings) into numbers, exactly", () => {
    const [d] = toNutritionDays([
      { day: "2026-09-20", kcal: "730.5", protein: "79.0", carbs: 63.7, fat: "15.7", entries: 3, meals: 2 },
    ]);
    expect(d).toEqual({ day: "2026-09-20", kcal: 730.5, protein: 79, carbs: 63.7, fat: 15.7, entries: 3, meals: 2 });
  });

  it("reads a null sum as 0 rather than NaN", () => {
    const [d] = toNutritionDays([{ day: "2026-09-20", kcal: null, protein: null, carbs: null, fat: null, entries: 1, meals: 1 }]);
    expect(d!.kcal).toBe(0);
    expect(Number.isNaN(d!.protein)).toBe(false);
  });

  it("returns days oldest first whatever order they arrive in", () => {
    const days = toNutritionDays([
      { day: "2026-09-22", kcal: 1, protein: 0, carbs: 0, fat: 0, entries: 1, meals: 1 },
      { day: "2026-09-20", kcal: 1, protein: 0, carbs: 0, fat: 0, entries: 1, meals: 1 },
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-09-20", "2026-09-22"]);
  });
});

describe("parseFoodParams", () => {
  it("defaults to the diary, 30 days, the calories chart", () => {
    expect(parseFoodParams({})).toEqual({ view: "diary", range: 30, chart: "kcal" });
  });

  it("reads the trends view, every range and every chart", () => {
    expect(parseFoodParams({ view: "trends", range: "all", chart: "macros" })).toEqual({ view: "trends", range: null, chart: "macros" });
    for (const r of [7, 30, 90, 365]) expect(parseFoodParams({ range: String(r) }).range).toBe(r);
  });

  it("falls back on unknown values", () => {
    expect(parseFoodParams({ view: "x", range: "5", chart: "sugar" })).toEqual({ view: "diary", range: 30, chart: "kcal" });
  });
});

describe("foodHref", () => {
  it("is plain /food for the diary", () => {
    expect(foodHref({ view: "diary", range: 30, chart: "kcal" })).toBe("/food");
  });

  it("round-trips the trends state", () => {
    const state = { view: "trends" as const, range: 7 as const, chart: "protein" as const };
    const params = Object.fromEntries(new URL(foodHref(state), "http://x").searchParams);
    expect(parseFoodParams(params)).toEqual(state);
  });
});

describe("toNutritionEntries", () => {
  const row = (over: Partial<NutritionEntryRow> = {}): NutritionEntryRow => ({
    date: "2026-09-20",
    slot: "lunch",
    grams: 150,
    kcal: "264",
    protein_g: 30.5,
    carbs_g: null,
    fat_g: "8.2",
    saturated_fat_g: "3.00",
    sugar_g: null,
    salt_g: 0.75,
    ...over,
  });

  it("keeps the snapshot macros and the snapshot label nutrients, as logged", () => {
    const [e] = toNutritionEntries([row()]);
    expect(e).toEqual({
      day: "2026-09-20", slot: "lunch", kcal: 264, protein: 30.5, carbs: 0, fat: 8.2,
      saturated_fat: 3, sugar: null, salt: 0.75,
    });
  });

  it("a label nutrient that was not measured is unknown, not zero", () => {
    const [e] = toNutritionEntries([row({ saturated_fat_g: null, salt_g: null })]);
    expect(e!.saturated_fat).toBeNull();
    expect(e!.salt).toBeNull();
  });

  it("drops a row whose slot is not one of the diary's four", () => {
    expect(toNutritionEntries([row({ slot: "brunch" })])).toEqual([]);
  });
});

describe("the per-macro charts", () => {
  it("accepts carbs and fat as charts", () => {
    expect(parseFoodParams({ view: "trends", chart: "carbs" }).chart).toBe("carbs");
    expect(parseFoodParams({ view: "trends", chart: "fat" }).chart).toBe("fat");
  });
});
