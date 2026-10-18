import { describe, expect, it } from "vitest";
import { gramsForPieces, portionsFor, practicalQuantity } from "./food-portions";

const EGG = portionsFor({ id: "x", name_en: "Egg, whole", name_ro: "Ou întreg" });
const BREAD = portionsFor({ id: "x", name_en: "Bread", name_ro: "Pâine" });

describe("practicalQuantity", () => {
  it("reads whole pieces of a serving the food has", () => {
    expect(practicalQuantity(100, EGG)).toMatchObject({ count: 2, unit: "M", grams: 100, exact: true, edible: true });
    expect(practicalQuantity(70, BREAD)).toMatchObject({ count: 2, unit: "slice", exact: true, edible: false });
  });

  it("says ≈ for a weight close to whole or half pieces", () => {
    const q = practicalQuantity(52, BREAD);
    expect(q).toMatchObject({ count: 1.5, unit: "slice", exact: false });
  });

  it("gives up rather than guessing when no serving fits", () => {
    expect(practicalQuantity(13, BREAD)).toBeNull();
  });

  it("has no practical unit for a food without servings — grams stay the answer", () => {
    expect(portionsFor({ id: "x", name_en: "Rice, raw", name_ro: "Orez" })).toEqual([]);
    expect(practicalQuantity(80, [])).toBeNull();
  });

  it("never multiplies a label that already counts more than one", () => {
    expect(practicalQuantity(140, [{ label: "2 slices", grams: 70, note: "" }])).toBeNull();
  });

  it("ignores zero and negative weights", () => {
    expect(practicalQuantity(0, EGG)).toBeNull();
  });
});

describe("gramsForPieces", () => {
  it("writes count × the serving, to 0.1 g", () => {
    expect(gramsForPieces(3, 58)).toBe(174);
    expect(gramsForPieces(1.5, 35)).toBe(52.5);
  });
});
