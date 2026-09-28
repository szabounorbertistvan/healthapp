import { describe, expect, it } from "vitest";
import { coverRect, placeInFrame, storyFileName } from "./photo-story";

describe("story cover crop", () => {
  it("a 4:5 photo fills the height and loses its sides, centred", () => {
    const r = coverRect(1280, 1600);
    expect(r.h).toBe(1920);
    expect(r.w).toBe(1536);
    expect(r.x).toBe(-228);
    expect(r.y).toBe(0);
  });
  it("a 16:9 photo fills the width and loses top and bottom", () => {
    const r = coverRect(1600, 900);
    expect(r.w).toBeCloseTo(3413.33, 1);
    expect(r.x).toBeCloseTo(-1166.67, 1);
    expect(r.y).toBe(0);
    expect(r.h).toBe(1920);
  });
});

describe("placing the author's elements inside the frame", () => {
  const photo = coverRect(1280, 1600); // x from -228 to 1308
  it("keeps an element the author put near the photo's left edge inside the frame", () => {
    const p = placeInFrame(photo, 0.05, 0.5, 400, 100);
    expect(p.x).toBe(56 + 200);
    expect(p.y).toBe(960);
  });
  it("leaves a centred element where it is", () => {
    const p = placeInFrame(photo, 0.5, 0.3, 400, 100);
    expect(p.x).toBe(540);
    expect(p.y).toBe(576);
  });
  it("centres an element wider than the frame rather than pushing it off", () => {
    const p = placeInFrame(photo, 0.9, 0.5, 1200, 100);
    expect(p.x).toBe(540);
  });
});

describe("storyFileName", () => {
  it("carries the day and the time of the export", () => {
    expect(storyFileName("2026-09-28", new Date(2026, 8, 28, 16, 7))).toBe("voinic-story-2026-09-28-1607.jpg");
  });
});
