import { describe, expect, it } from "vitest";
import { weeklyTotals, weekStartOf } from "./weekly-series";

describe("weekStartOf", () => {
  it("snaps every day of a week to its Monday", () => {
    // 2026-09-14 is a Monday; 2026-09-20 the Sunday that closes the same week.
    for (const day of ["2026-09-14", "2026-09-17", "2026-09-20"]) {
      expect(weekStartOf(day), day).toBe("2026-09-14");
    }
    expect(weekStartOf("2026-09-21")).toBe("2026-09-21");
    expect(weekStartOf("2026-09-13")).toBe("2026-09-07");
  });

  it("accepts a full timestamp", () => {
    expect(weekStartOf("2026-09-17T22:45:00.000Z")).toBe("2026-09-14");
  });
});

describe("weeklyTotals", () => {
  const today = new Date("2026-09-16T12:00:00Z"); // Wednesday

  it("sums into the right week and keeps empty ones", () => {
    const series = weeklyTotals(
      [
        { at: "2026-09-16", value: 1000 },
        { at: "2026-09-14", value: 500 },
        { at: "2026-09-02", value: 300 },
      ],
      3,
      today,
    );
    expect(series.map((b) => b.week_start)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(series.map((b) => b.value)).toEqual([300, 0, 1500]);
    expect(series.map((b) => b.count)).toEqual([1, 0, 2]);
  });

  it("ignores events outside the window", () => {
    const series = weeklyTotals(
      [{ at: "2020-01-01", value: 99 }, { at: "2030-01-01", value: 99 }],
      2,
      today,
    );
    expect(series.every((b) => b.value === 0)).toBe(true);
  });

  it("always returns exactly `weeks` buckets, even with no events", () => {
    expect(weeklyTotals([], 12, today)).toHaveLength(12);
  });
});
