import type { FoodDayV1 } from "@healthapp/api/v1";
import { portionMacros } from "@healthapp/shared";
import { describe, expect, it } from "vitest";
import { diary, foodName, shiftDay, sumMacros, totalsWithPending } from "./food-model";
import type { QueuedFood } from "./outbox-core";

const rice = { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 };
const day = (over: Partial<FoodDayV1> = {}): FoodDayV1 => ({
  day: "2026-10-23", today: "2026-10-23", plan_name: null, plan_owner: null,
  target: { kcal: 2000, protein: 150, carbs: 200, fat: 60 },
  totals: { kcal: 300, protein: 20, carbs: 30, fat: 10 },
  entries: [{ id: "e1", slot: "breakfast", food_name: "Oats", grams: 80, macros: { kcal: 300, protein: 20, carbs: 30, fat: 10 } }],
  planned: [], quick: { recent: [], favorites: [] }, ...over,
});
const queued = (id: string, grams: number, dayIso = "2026-10-23", error?: string): QueuedFood => ({
  kind: "food", id, userId: "me", queuedAt: "2026-10-23T12:00:00Z", error,
  input: { slot: "lunch", foodName: "Rice", grams, per100g: rice, foodId: null, day: dayIso, clientId: id },
});

describe("diary", () => {
  it("puts server entries and waiting logs under their meals", () => {
    const d = diary(day(), [queued("q1", 150)]);
    expect(d.breakfast.map((e) => e.state)).toEqual(["synced"]);
    expect(d.lunch).toHaveLength(1);
    expect(d.lunch[0]).toMatchObject({ state: "pending", id: null, localId: "q1", grams: 150 });
    expect(d.lunch[0]!.macros).toEqual(portionMacros(rice, 150));
    expect(d.dinner).toEqual([]);
  });

  it("leaves another day's logs out", () => {
    expect(diary(day(), [queued("q1", 150, "2026-10-22")]).lunch).toEqual([]);
  });
});

describe("totals", () => {
  it("adds what is still waiting, but not what was refused", () => {
    const t = totalsWithPending(day(), [queued("q1", 100), queued("q2", 100, "2026-10-23", "refused")]);
    expect(t.kcal).toBeCloseTo(300 + portionMacros(rice, 100).kcal);
  });

  it("sums a meal", () => {
    expect(sumMacros([{ macros: rice }, { macros: rice }]).kcal).toBe(260);
  });
});

describe("helpers", () => {
  it("names a food in the reader's language, falling back to English", () => {
    expect(foodName({ name_en: "Cabbage", name_ro: "Varză" }, "ro")).toBe("Varză");
    expect(foodName({ name_en: "Cabbage", name_ro: "" }, "ro")).toBe("Cabbage");
    expect(foodName({ name_en: "Cabbage", name_ro: "Varză" }, "en")).toBe("Cabbage");
  });

  it("moves across month and year ends", () => {
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
  });
});
