import { describe, expect, it } from "vitest";
import { dishfinderIdFromOff, OFF_TO_DISHFINDER } from "./off-dishfinder.ts";

// Real category chains from Open Food Facts, general → specific.
describe("dishfinderIdFromOff", () => {
  it("links a plain ingredient by its most specific tag", () => {
    expect(dishfinderIdFromOff(["en:plant-based-foods", "en:cereals-and-potatoes", "en:cereals", "en:flakes", "en:rolled-oats"])).toBe(3400);
    expect(dishfinderIdFromOff(["en:dairies", "en:fermented-foods", "en:fermented-milk-products", "en:yogurts", "en:greek-yogurts"])).toBe(3317);
    expect(dishfinderIdFromOff(["en:meats", "en:poultries", "en:chickens", "en:chicken-breasts"])).toBe(3129);
  });

  it("falls back to a more general mapped tag when the specific one is unknown", () => {
    expect(dishfinderIdFromOff(["en:dairies", "en:milks", "en:some-regional-milk"])).toBe(3293);
  });

  it("refuses a flavoured or prepared product even when a parent tag is mapped", () => {
    expect(dishfinderIdFromOff(["en:dairies", "en:milks", "en:flavoured-milks", "en:chocolate-milks"])).toBeNull();
    expect(dishfinderIdFromOff(["en:cereals", "en:breakfast-cereals", "en:chocolate-cereals"])).toBeNull();
    expect(dishfinderIdFromOff(["en:dairies", "en:yogurts", "en:fruit-yogurts"])).toBeNull();
  });

  it("links a pâté or ham although OFF files it under prepared meats", () => {
    expect(dishfinderIdFromOff(["en:meats", "en:prepared-meats", "en:pork", "en:pate", "en:pork-pates"])).toBe(4877);
    expect(dishfinderIdFromOff(["en:meats", "en:prepared-meats", "en:pork-pates", "en:ready-meals"])).toBeNull();
    expect(dishfinderIdFromOff(["en:meats", "en:prepared-meats", "en:beef"])).toBeNull();
  });

  it("returns null for products that are not one ingredient", () => {
    expect(dishfinderIdFromOff(["en:snacks", "en:salty-snacks", "en:crisps"])).toBeNull();
    expect(dishfinderIdFromOff([])).toBeNull();
    expect(dishfinderIdFromOff(undefined)).toBeNull();
    expect(dishfinderIdFromOff("en:milks")).toBeNull();
  });

  it("uses the bare name only when the product has no categories at all", () => {
    expect(dishfinderIdFromOff(undefined, "Iaurt")).toBe(3316);
    expect(dishfinderIdFromOff([], "Fulgi de ovăz")).toBe(3400);
    expect(dishfinderIdFromOff(undefined, "Iaurt de băut cu căpșuni")).toBeNull();
    expect(dishfinderIdFromOff(["en:snacks"], "Iaurt")).toBeNull();
    expect(dishfinderIdFromOff([], "Soy Protein Isolate")).toBe(4511);
    expect(dishfinderIdFromOff([], "Brânză de burduf")).toBe(4477);
    expect(dishfinderIdFromOff([], "Șuncă din piept de curcan")).toBe(5045);
    expect(dishfinderIdFromOff([], "Gymbeam True Whey Prodigest")).toBeNull();
  });

  it("maps only to positive DishFinder ids", () => {
    for (const [tag, id] of Object.entries(OFF_TO_DISHFINDER) as [string, number][]) {
      expect(tag.startsWith("en:"), tag).toBe(true);
      expect(Number.isInteger(id) && id > 0, tag).toBe(true);
    }
  });
});
