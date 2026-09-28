import { describe, expect, it } from "vitest";
import { OVERLAY_STAT_STYLES } from "@healthapp/shared";
import { clampCentre, defaultStatsPlacement, layoutStats, overlayStatRows, statCellHeight, wrapLines } from "./photo-overlay";

describe("photo overlay geometry", () => {
  it("the grid is one column for one figure and two for more", () => {
    expect(layoutStats(1, "grid", 1).cells.map((c) => c.x)).toEqual([0]);
    const five = layoutStats(5, "grid", 1).cells;
    expect(new Set(five.map((c) => c.x)).size).toBe(2);
    expect(new Set(five.map((c) => c.y)).size).toBe(3);
  });
  it("row is one line, column is one per line, hero puts the first figure above the rest", () => {
    expect(new Set(layoutStats(4, "row", 1).cells.map((c) => c.y)).size).toBe(1);
    expect(new Set(layoutStats(4, "column", 1).cells.map((c) => c.x)).size).toBe(1);
    const hero = layoutStats(4, "hero", 1).cells;
    expect(hero[0]!.value).toBeGreaterThan(hero[1]!.value * 2);
    expect(hero.slice(1).every((c) => c.y > hero[0]!.y + statCellHeight(hero[0]!))).toBe(true);
  });
  it("no style, size or count overflows the photo, and no two figures overlap", () => {
    for (const style of OVERLAY_STAT_STYLES) {
      for (const size of [0.5, 0.82, 1, 1.24, 2]) {
        for (let n = 1; n <= 6; n++) {
          const box = layoutStats(n, style, size);
          expect(box.w).toBeLessThanOrEqual(0.92 + 1e-9);
          const rects = box.cells.map((c) => ({ x0: c.x, x1: c.x + c.w, y0: c.y, y1: c.y + statCellHeight(c) }));
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]!, b = rects[j]!;
            const overlap = a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.y0 < b.y1 - 1e-9 && b.y0 < a.y1 - 1e-9;
            expect(overlap, `${style} ${size} n=${n} cells ${i},${j}`).toBe(false);
          }
        }
      }
    }
  });
  it("a larger size is a larger block, until the width cap", () => {
    expect(layoutStats(4, "grid", 1.24).w).toBeGreaterThan(layoutStats(4, "grid", 1).w);
    expect(layoutStats(4, "column", 0.82).h).toBeLessThan(layoutStats(4, "column", 1).h);
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
      { x: 0.5, y: 0.5, keys: ["duration", "sets", "prs"], scale: 1, style: "grid" },
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
