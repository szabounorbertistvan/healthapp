import { describe, expect, it } from "vitest";
import { isTarget, revealOffset } from "./tour";

describe("isTarget", () => {
  it("a measured element with a size is a target", () => {
    expect(isTarget({ x: 0, y: 10, width: 300, height: 120 })).toBe(true);
  });

  it("nothing measured, or an empty wrapper, is not", () => {
    expect(isTarget(null)).toBe(false);
    expect(isTarget({ x: 0, y: 10, width: 300, height: 0 })).toBe(false);
  });
});

describe("revealOffset", () => {
  const band = { top: 50, bottom: 700 };

  it("leaves a target that is already in view alone", () => {
    expect(revealOffset({ y: 100, height: 200 }, band, 0)).toBeNull();
  });

  it("scrolls down to a target below the band, keeping a margin above it", () => {
    expect(revealOffset({ y: 900, height: 200 }, band, 300)).toBe(300 + 900 - 50 - 80);
  });

  it("scrolls back up to a target above it, never past the top", () => {
    expect(revealOffset({ y: -400, height: 100 }, band, 200)).toBe(0);
  });

  it("a target taller than the band is revealed from its top", () => {
    expect(revealOffset({ y: 60, height: 900 }, band, 0)).toBe(0);
  });
});
