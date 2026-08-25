import { describe, expect, test } from "vitest";
import { estimated1RM, isPersonalRecord } from "./prs";

// PRODUCT_SPEC Epic B3: "A set beating the stored best (estimated 1RM, Epley)
// is flagged". Detection runs on the device so the celebration is instant, and
// again server-side on sync — both must agree, hence one implementation.

describe("estimated1RM", () => {
  test("applies the Epley formula", () => {
    expect(estimated1RM(100, 5)).toBe(116.7);
  });

  test("returns the bar weight itself for a single rep", () => {
    expect(estimated1RM(140, 1)).toBe(140);
  });

  test("returns zero for a set that was never performed", () => {
    expect(estimated1RM(100, 0)).toBe(0);
  });

  test("returns zero for a bodyweight set with no load", () => {
    expect(estimated1RM(0, 12)).toBe(0);
  });
});

describe("isPersonalRecord", () => {
  test("flags a set that beats the stored best", () => {
    expect(isPersonalRecord({ weight: 85, reps: 8 }, 102)).toBe(true);
  });

  test("does not flag a set that only matches the stored best", () => {
    expect(isPersonalRecord({ weight: 100, reps: 1 }, 100)).toBe(false);
  });

  test("flags the first set of an exercise with no history", () => {
    expect(isPersonalRecord({ weight: 60, reps: 10 }, null)).toBe(true);
  });

  test("does not flag a set that was never performed", () => {
    expect(isPersonalRecord({ weight: 60, reps: 0 }, null)).toBe(false);
  });
});
