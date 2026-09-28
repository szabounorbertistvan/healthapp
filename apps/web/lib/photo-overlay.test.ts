import { describe, expect, it } from "vitest";
import { clampCentre, defaultStatsPlacement, overlayStatRows, overlayStatsBox, wrapLines } from "./photo-overlay";

describe("photo overlay geometry", () => {
  it("one figure is one column; two to six are two", () => {
    expect(overlayStatsBox(1, "m")).toMatchObject({ cols: 1, rows: 1 });
    expect(overlayStatsBox(2, "m")).toMatchObject({ cols: 2, rows: 1 });
    expect(overlayStatsBox(5, "m")).toMatchObject({ cols: 2, rows: 3 });
  });
  it("a larger size is a wider and taller box", () => {
    expect(overlayStatsBox(4, "l").w).toBeGreaterThan(overlayStatsBox(4, "m").w);
    expect(overlayStatsBox(4, "s").h).toBeLessThan(overlayStatsBox(4, "m").h);
  });
  it("the centre is clamped so the element stays inside the photo", () => {
    expect(clampCentre(0, 0, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1 });
    expect(clampCentre(1, 1, 0.2, 0.1)).toEqual({ x: 0.8, y: 0.9 });
    expect(clampCentre(0.5, 0.5, 0.2, 0.1)).toEqual({ x: 0.5, y: 0.5 });
  });
  it("the default stats placement is inside a portrait and a landscape photo alike", () => {
    for (const aspect of [1.25, 1, 0.5625]) {
      const p = defaultStatsPlacement(4, aspect);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
  });
  it("the rows follow the chosen keys and skip a figure the post cannot supply", () => {
    const rows = overlayStatRows(
      { x: 0.5, y: 0.5, keys: ["duration", "sets", "prs"], size: "m" },
      { sets: { value: "28", label: "sets" }, prs: { value: "2", label: "PRs" } },
    );
    expect(rows.map((r) => r.key)).toEqual(["sets", "prs"]);
    expect(overlayStatRows(null, {})).toEqual([]);
  });
  it("wraps on words, never inside one", () => {
    const width = (s: string) => s.length * 10;
    expect(wrapLines("leg day was brutal", 100, width)).toEqual(["leg day", "was brutal"]);
    expect(wrapLines("supercalifragilistic", 50, width)).toEqual(["supercalifragilistic"]);
    expect(wrapLines("   ", 50, width)).toEqual([]);
  });
});
