import { describe, expect, it } from "vitest";
import { distributionBars, ratingLabel, reviewErrorCode } from "./coach-review";

const words = { one: "review", many: "reviews" };

describe("rating label (the Discovery card's signal)", () => {
  it("one decimal, the star and the count", () => {
    expect(ratingLabel({ average: 4.92, count: 27 }, words, "en")).toBe("4.9 ★ · 27 reviews");
    expect(ratingLabel({ average: "3.00", count: 1 }, words, "en")).toBe("3.0 ★ · 1 review");
  });
  it("the reader's decimal separator", () => {
    expect(ratingLabel({ average: 4.5, count: 2 }, { one: "recenzie", many: "recenzii" }, "ro")).toBe("4,5 ★ · 2 recenzii");
  });
  it("nothing to show is nothing, never a made-up rating", () => {
    expect(ratingLabel(null, words, "en")).toBeNull();
    expect(ratingLabel({ average: null, count: 0 }, words, "en")).toBeNull();
  });
});

describe("distribution bars", () => {
  it("5 stars first, whole percentages of the total", () => {
    expect(distributionBars([0, 1, 1, 1, 0])).toEqual([
      { stars: 5, count: 0, pct: 0 }, { stars: 4, count: 1, pct: 33 }, { stars: 3, count: 1, pct: 33 },
      { stars: 2, count: 1, pct: 33 }, { stars: 1, count: 0, pct: 0 },
    ]);
  });
  it("no reviews: empty bars, no division by zero", () => {
    expect(distributionBars([0, 0, 0, 0, 0]).every((b) => b.pct === 0)).toBe(true);
  });
});

describe("error codes", () => {
  it("reads the code a review RPC raised", () => {
    expect(reviewErrorCode({ message: "NOT_ELIGIBLE" })).toBe("NOT_ELIGIBLE");
    expect(reviewErrorCode({ message: "something else" })).toBeNull();
  });
});
