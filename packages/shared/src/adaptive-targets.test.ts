import { describe, expect, it } from "vitest";
import { adaptiveEstimate, MIN_SUGGESTED_KCAL, targetForGoal } from "./adaptive-targets";
import { shiftDays } from "./weekly-summary";

const TODAY = "2026-10-14";
/** `n` diary days ending today, each `kcal`. */
function diary(n: number, kcal: number | ((i: number) => number)) {
  return Array.from({ length: n }, (_, i) => ({ day: shiftDays(TODAY, -i), kcal: typeof kcal === "number" ? kcal : kcal(i) }));
}
/** A weigh-in every `every` days for 28 days, on a straight line of `perWeek` kg/week ending at `end`. */
function scale(end: number, perWeek: number, every = 3) {
  const out: { day: string; weight_kg: number }[] = [];
  for (let back = 0; back < 28; back += every) out.push({ day: shiftDays(TODAY, -back), weight_kg: end - (perWeek / 7) * back });
  return out;
}

describe("adaptiveEstimate", () => {
  it("reads maintenance off a losing trend", () => {
    // 2,300 kcal a day while losing 0.35 kg/week → maintenance ≈ 2,300 + 385
    const e = adaptiveEstimate({ today: TODAY, days: diary(28, 2300), weights: scale(80, -0.35) });
    expect(e.status).toBe("ok");
    if (e.status !== "ok") return;
    // 2,685 exactly; rounding to 10 may land either side of the half
    expect(Math.abs(e.tdee - 2685)).toBeLessThanOrEqual(5);
    expect(e.weekly_change_kg).toBeCloseTo(-0.35, 2);
    expect(e.trend_weight_kg).toBe(80);
    expect(e.targets.maintain).toBe(e.tdee);
    // lose 0.5% of 80 kg = 0.4 kg/week = 440 kcal/day; gain 0.25% = 220 kcal/day
    expect(e.targets.lose).toBe(e.tdee - 440);
    expect(e.targets.gain).toBe(e.tdee + 220);
  });

  it("equals intake when the weight is flat", () => {
    const e = adaptiveEstimate({ today: TODAY, days: diary(20, 2000), weights: scale(70, 0) });
    expect(e.status === "ok" && e.tdee).toBe(2000);
  });

  it("skips half-logged days instead of averaging them in", () => {
    const days = diary(20, (i) => (i % 5 === 0 ? 600 : 2200));
    const e = adaptiveEstimate({ today: TODAY, days, weights: scale(75, 0) });
    expect(e.status === "ok" && e.avg_intake).toBe(2200);
    expect(e.status === "ok" && e.logged_days).toBe(16);
  });

  it("waits for enough logged days", () => {
    const e = adaptiveEstimate({ today: TODAY, days: diary(6, 2000), weights: scale(70, 0) });
    expect(e).toMatchObject({ status: "not_enough", logged_days: 6 });
  });

  it("waits for weigh-ins spread over time", () => {
    const close = [0, 1, 2, 3].map((b) => ({ day: shiftDays(TODAY, -b), weight_kg: 70 }));
    expect(adaptiveEstimate({ today: TODAY, days: diary(28, 2000), weights: close }))
      .toMatchObject({ status: "not_enough", weigh_ins: 4, weigh_span_days: 3 });
  });

  it("ignores anything outside the 28-day window", () => {
    const old = diary(60, 2000).filter((d) => d.day < shiftDays(TODAY, -27));
    expect(adaptiveEstimate({ today: TODAY, days: old, weights: scale(70, 0) })).toMatchObject({ status: "not_enough", logged_days: 0 });
  });

  it("averages several weigh-ins on one day", () => {
    const w = [...scale(70, 0), { day: TODAY, weight_kg: 70 }];
    const e = adaptiveEstimate({ today: TODAY, days: diary(20, 2000), weights: w });
    expect(e.status === "ok" && e.weigh_ins).toBe(10);
  });

  it("calls an impossible estimate implausible rather than suggesting it", () => {
    // 800 kcal a day while gaining a kilo a week: the diary is not the whole story
    const e = adaptiveEstimate({ today: TODAY, days: diary(28, 800), weights: scale(70, 1) });
    expect(e.status).toBe("implausible");
  });
});

describe("targetForGoal", () => {
  it("caps the deficit at a quarter of maintenance", () => {
    // 0.5% of 150 kg = 0.75 kg/week = 825 kcal/day, capped at 25% of 2,000 = 500
    expect(targetForGoal(2000, 150, "lose")).toBe(1500);
  });
  it("never goes under the floor", () => {
    expect(targetForGoal(1400, 60, "lose")).toBe(MIN_SUGGESTED_KCAL);
  });
});
