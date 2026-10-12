import { describe, expect, it } from "vitest";
import { gymOpenState, type GymPeriod } from "./gym-hours";

const weekday = (day: number, open: [number, number], close: [number, number]): GymPeriod => ({
  open: { day, hour: open[0], minute: open[1] },
  close: { day, hour: close[0], minute: close[1] },
});

describe("gymOpenState", () => {
  const monday = [weekday(1, [6, 0], [23, 0])];

  it("is open inside a period and closed outside it", () => {
    expect(gymOpenState(monday, 1, 6, 0)).toBe("open");
    expect(gymOpenState(monday, 1, 22, 59)).toBe("open");
    expect(gymOpenState(monday, 1, 23, 0)).toBe("closed");
    expect(gymOpenState(monday, 1, 5, 59)).toBe("closed");
    expect(gymOpenState(monday, 2, 12, 0)).toBe("closed");
  });

  it("follows a period past midnight", () => {
    const late = [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }];
    expect(gymOpenState(late, 6, 1, 30)).toBe("open");
    expect(gymOpenState(late, 6, 2, 0)).toBe("closed");
  });

  it("wraps Saturday night into Sunday", () => {
    const wrap = [{ open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 4, minute: 0 } }];
    expect(gymOpenState(wrap, 0, 3, 0)).toBe("open");
    expect(gymOpenState(wrap, 6, 23, 0)).toBe("open");
    expect(gymOpenState(wrap, 0, 5, 0)).toBe("closed");
  });

  it("reads a period without a close as 24/7", () => {
    expect(gymOpenState([{ open: { day: 0, hour: 0, minute: 0 } }], 3, 3, 3)).toBe("open");
  });

  it("does not guess without hours", () => {
    expect(gymOpenState(null, 1, 12, 0)).toBe("unknown");
    expect(gymOpenState([], 1, 12, 0)).toBe("unknown");
  });
});
