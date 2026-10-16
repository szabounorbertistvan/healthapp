import { describe, expect, it } from "vitest";
import {
  gramsFromQuantity, HANDOFF_MAX_AGE_S, parseHandoff, proposedServingGrams, recomputedServing, scaledServing,
  type DialogLine, type RecipeHandoff,
} from "./recipe-handoff";

const NOW = 1_800_000_000;
function handoff(over: Partial<RecipeHandoff["recipe"]> = {}, iat = NOW - 10, exp = NOW + 600): RecipeHandoff {
  return {
    v: 1, iat, exp,
    recipe: {
      id: 99648, title: "Sarmale tradiționale", url: "https://dishfinder.food/cooking/recipes/99648", image: null,
      servings: 40, per_serving: { kcal: 123, protein: 5.8, carbs: 6.3, fat: 8.4 },
      ingredients: [{ df_id: 9001, name: "varză murată", qty: "1,5 kg" }, { df_id: null, name: "sare", qty: "după gust" }],
      ...over,
    },
  };
}

describe("parseHandoff", () => {
  it("accepts a well-formed, fresh hand-off", () => {
    const r = parseHandoff(JSON.stringify(handoff()), NOW);
    expect(r.ok).toBe(true);
  });
  it("refuses an expired one, and one issued for longer than the window", () => {
    expect(parseHandoff(JSON.stringify(handoff({}, NOW - 2000, NOW - 1)), NOW)).toEqual({ ok: false, error: "HANDOFF_EXPIRED" });
    expect(parseHandoff(JSON.stringify(handoff({}, NOW, NOW + HANDOFF_MAX_AGE_S + 1)), NOW)).toEqual({ ok: false, error: "HANDOFF_EXPIRED" });
  });
  it("refuses a link back that is not https", () => {
    expect(parseHandoff(JSON.stringify(handoff({ url: "javascript:alert(1)" })), NOW).ok).toBe(false);
  });
  it("refuses impossible numbers and junk", () => {
    expect(parseHandoff(JSON.stringify(handoff({ servings: 0 })), NOW).ok).toBe(false);
    expect(parseHandoff(JSON.stringify(handoff({ per_serving: { kcal: -5, protein: 0, carbs: 0, fat: 0 } })), NOW).ok).toBe(false);
    expect(parseHandoff("not json", NOW)).toEqual({ ok: false, error: "HANDOFF_MALFORMED" });
  });
  it("caps the number of lines", () => {
    const many = Array.from({ length: 61 }, (_, i) => ({ df_id: i + 1, name: `x${i}`, qty: null }));
    expect(parseHandoff(JSON.stringify(handoff({ ingredients: many })), NOW).ok).toBe(false);
  });
});

describe("gramsFromQuantity", () => {
  it("reads grams, kilos and millilitres in either decimal style", () => {
    expect(gramsFromQuantity("500 g")).toBe(500);
    expect(gramsFromQuantity("1,5 kg")).toBe(1500);
    expect(gramsFromQuantity("250ml")).toBe(250);
    expect(gramsFromQuantity("0.5 l")).toBe(500);
    expect(gramsFromQuantity("aprox. 200 grame")).toBe(200);
  });
  it("does not guess spoons, pieces or 'to taste'", () => {
    expect(gramsFromQuantity("2 linguri")).toBeNull();
    expect(gramsFromQuantity("1 ceapă")).toBeNull();
    expect(gramsFromQuantity("după gust")).toBeNull();
    expect(gramsFromQuantity(null)).toBeNull();
  });
});

describe("serving arithmetic", () => {
  const rice = { id: "r", per100: { kcal: 360, protein: 7, carbs: 79, fat: 0.6 } };
  const kraut = { id: "k", per100: { kcal: 19, protein: 0.9, carbs: 4.3, fat: 0.1 } };
  const lines: DialogLine[] = [
    { food: kraut, grams: 1500, include: true },
    { food: rice, grams: 500, include: true },
    { food: null, grams: null, include: true },
    { food: rice, grams: 1000, include: false },
  ];

  it("proposes a serving weight from the stated grams", () => {
    expect(proposedServingGrams(lines, 40)).toBe(50);
    expect(proposedServingGrams([{ food: null, grams: null, include: true }], 4)).toBeNull();
  });

  it("recomputes one serving from the matched foods and counts what could not count", () => {
    const r = recomputedServing(lines, 40);
    // 1500 g kraut = 285 kcal, 500 g rice = 1800 kcal → 2085 / 40
    expect(r.macros.kcal).toBe(52);
    expect(r.missing).toBe(1);
  });

  it("rescales DishFinder's serving when the serving count changes", () => {
    expect(scaledServing({ kcal: 123, protein: 5.8, carbs: 6.3, fat: 8.4 }, 40, 20)).toEqual({ kcal: 246, protein: 11.6, carbs: 12.6, fat: 16.8 });
  });
});
