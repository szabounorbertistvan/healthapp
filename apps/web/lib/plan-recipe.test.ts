import { describe, expect, it } from "vitest";
import { toPlanRecipe } from "./plan-recipe";

describe("toPlanRecipe", () => {
  it("is 'none' without a link — a deleted recipe unlinks itself", () => {
    expect(toPlanRecipe(null, null)).toBe("none");
  });
  it("is 'unavailable' when the link cannot be followed by the reader", () => {
    expect(toPlanRecipe("00000000-0000-4000-8000-000000000001", null)).toBe("unavailable");
  });
  it("orders the lines and turns numeric strings into numbers", () => {
    const r = toPlanRecipe("r", {
      id: "r", title: "Sarmale", servings: "40", serving_grams: "80", prep_minutes: 40, cook_minutes: null, steps: null,
      recipe_ingredients: [{ position: 1, label: "500 g orez", grams: "500" }, { position: 0, label: "1 varză", grams: null }],
    });
    expect(r).toEqual({
      id: "r", title: "Sarmale", servings: 40, serving_grams: 80, prep_minutes: 40, cook_minutes: null, steps: [],
      lines: [{ label: "1 varză", grams: null }, { label: "500 g orez", grams: 500 }],
    });
  });
});
