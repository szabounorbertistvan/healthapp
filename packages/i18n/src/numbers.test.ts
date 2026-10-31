import { describe, expect, it } from "vitest";
import { formatDecimal } from "./numbers";

describe("formatDecimal", () => {
  it("uses a comma in Romanian and a point in English", () => {
    expect(formatDecimal(72.5, "ro")).toBe("72,5");
    expect(formatDecimal(72.5, "en")).toBe("72.5");
  });
  it("rounds and drops trailing zeros", () => {
    expect(formatDecimal(80, "ro")).toBe("80");
    expect(formatDecimal(80.04, "ro")).toBe("80");
    expect(formatDecimal(80.26, "ro")).toBe("80,3");
    expect(formatDecimal(1.256, "ro", { maxDecimals: 2 })).toBe("1,26");
    expect(formatDecimal(2, "ro", { minDecimals: 1, maxDecimals: 1 })).toBe("2,0");
  });
  it("never shows a negative zero", () => {
    expect(formatDecimal(-0.01, "ro")).toBe("0");
    expect(formatDecimal(-1.25, "ro", { maxDecimals: 2 })).toBe("-1,25");
  });
  it("shows a dash for a value that is not a number", () => {
    expect(formatDecimal(Number.NaN, "en")).toBe("–");
  });
});

