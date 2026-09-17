import { describe, expect, it } from "vitest";
import {
  cmToDisplay, displayToCm, displayToKg, formatLength, formatWeight, kgToDisplay,
} from "./units";

describe("weight conversion", () => {
  it("leaves kilograms alone", () => {
    expect(kgToDisplay(82.5, "kg")).toBe(82.5);
    expect(displayToKg(82.5, "kg")).toBe(82.5);
  });

  it("converts to pounds and back without drift", () => {
    expect(kgToDisplay(100, "lb")).toBe(220.5);
    expect(kgToDisplay(20, "lb")).toBe(44.1);
    // What matters is the round trip: type 185 lb, store, read it back.
    const stored = displayToKg(185, "lb");
    expect(kgToDisplay(stored, "lb")).toBe(185);
  });

  it("keeps a typed value exact on the way in", () => {
    // Rounding on input would make 82.4 kg drift every time it was edited.
    expect(displayToKg(82.47, "kg")).toBe(82.47);
  });
});

describe("length conversion", () => {
  it("converts centimetres to inches and back", () => {
    expect(cmToDisplay(85, "in")).toBe(33.5);
    expect(cmToDisplay(85, "cm")).toBe(85);
    const stored = displayToCm(33.5, "in");
    expect(cmToDisplay(stored, "in")).toBe(33.5);
  });
});

describe("formatWeight", () => {
  it("shows the unit it converted to", () => {
    expect(formatWeight(82.5, "kg")).toBe("82.5 kg");
    expect(formatWeight(100, "lb")).toBe("220.5 lb");
  });

  it("drops the decimal on totals nobody reads to a tenth", () => {
    expect(formatWeight(12480.3, "kg", { locale: "en" })).toBe("12,480 kg");
    expect(formatWeight(500, "kg", { big: true, locale: "en" })).toBe("500 kg");
  });

  it("does not print a number for missing data", () => {
    expect(formatWeight(null, "kg")).toBe("—");
    expect(formatWeight(undefined, "lb")).toBe("—");
    expect(formatLength(null, "cm")).toBe("—");
  });
});
