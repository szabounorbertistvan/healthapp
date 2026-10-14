import { describe, expect, it } from "vitest";
import { macroScore } from "./adherence";
import {
  isLoggedDay,
  labelNutrientChange,
  labelNutrients,
  LABEL_COVERAGE_MIN,
  mealDistribution,
  PARTIAL_DAY_MAX_MEALS,
  trackedDays,
  type NutritionEntry,
  macroAdherence,
  macroDistribution,
  macroLine,
  MIN_INSIGHT_DAYS,
  nutritionInsights,
  nutritionPeriod,
  nutritionProgress,
  nutritionSeries,
  weekNutrition,
  type NutritionDay,
} from "./nutrition-progress";
import { progressWindows } from "./progress";

const TARGET = { kcal: 2400, protein: 180, carbs: 240, fat: 75 };

function day(d: string, over: Partial<NutritionDay> = {}): NutritionDay {
  return { day: d, kcal: 2000, protein: 150, carbs: 200, fat: 60, entries: 4, meals: 3, ...over };
}

// ---------- one line ----------

describe("macroLine", () => {
  it("separates consumed, target, difference and percentage, unrounded", () => {
    const l = macroLine(145, 180);
    expect(l).toEqual({ consumed: 145, target: 180, difference: 145 - 180, pct: (145 / 180) * 100 });
    expect(l.pct).toBeCloseTo(80.556, 3);
  });

  it("has no target, difference or percentage when the target is missing or zero", () => {
    expect(macroLine(145, 0)).toEqual({ consumed: 145, target: null, difference: null, pct: null });
    expect(macroLine(145, null)).toEqual({ consumed: 145, target: null, difference: null, pct: null });
  });

  it("does not let impossible values through: NaN, infinity and negatives read as 0", () => {
    expect(macroLine(Number.NaN, 180).consumed).toBe(0);
    expect(macroLine(-20, 180).consumed).toBe(0);
    expect(macroLine(Number.POSITIVE_INFINITY, 180).consumed).toBe(0);
    expect(macroLine(100, Number.NaN).target).toBeNull();
  });

  it("keeps a percentage above 100 — being over is information", () => {
    expect(macroLine(270, 180).pct).toBe(150);
  });
});

describe("macroAdherence", () => {
  it("builds one line per macro", () => {
    const a = macroAdherence({ kcal: 1850, protein: 145, carbs: 170, fat: 58 }, TARGET);
    expect(a.kcal.difference).toBe(-550);
    expect(a.protein.pct).toBeCloseTo(80.556, 3);
    expect(a.fat.target).toBe(75);
  });

  it("with no target at all, every line has only the consumed value", () => {
    const a = macroAdherence({ kcal: 1850, protein: 145, carbs: 170, fat: 58 }, null);
    expect(Object.values(a).every((l) => l.target === null && l.pct === null)).toBe(true);
  });
});

// ---------- logged days ----------

describe("isLoggedDay", () => {
  it("uses the weekly summary's rule: a day with calories", () => {
    expect(isLoggedDay(day("2026-09-20"))).toBe(true);
    expect(isLoggedDay(day("2026-09-20", { kcal: 0, entries: 1 }))).toBe(false);
  });
});

// ---------- a period ----------

describe("nutritionPeriod", () => {
  const week = { start: "2026-09-20", end: "2026-09-26" };

  it("empty data: no averages, no adherence, zero days logged", () => {
    const p = nutritionPeriod([], week, TARGET);
    expect(p.days_logged).toBe(0);
    expect(p.window_days).toBe(7);
    expect(p.avg).toBeNull();
    expect(p.adherence).toBeNull();
    expect(p.kcal_score).toBeNull();
    expect(p.highest).toBeNull();
  });

  it("averages over logged days only — an unlogged day is not a day of eating zero", () => {
    const p = nutritionPeriod([day("2026-09-21", { kcal: 2000 }), day("2026-09-23", { kcal: 2500 })], week, TARGET);
    expect(p.days_logged).toBe(2);
    expect(p.avg!.kcal).toBe(2250);
  });

  it("ignores days outside the window and days with no calories", () => {
    const p = nutritionPeriod(
      [day("2026-09-19", { kcal: 9000 }), day("2026-09-22", { kcal: 0, protein: 0 }), day("2026-09-24", { kcal: 1800 })],
      week,
      TARGET,
    );
    expect(p.days_logged).toBe(1);
    expect(p.avg!.kcal).toBe(1800);
  });

  it("keeps averages exact", () => {
    const p = nutritionPeriod([day("2026-09-21", { protein: 150.5 }), day("2026-09-22", { protein: 140.2 })], week, TARGET);
    expect(p.avg!.protein).toBe((150.5 + 140.2) / 2);
  });

  it("compares the average with the target, macro by macro", () => {
    const p = nutritionPeriod([day("2026-09-21", { protein: 144 }), day("2026-09-22", { protein: 216 })], week, TARGET);
    expect(p.adherence!.protein.consumed).toBe(180);
    expect(p.adherence!.protein.pct).toBe(100);
  });

  it("scores calorie adherence with the same macroScore() the coach dashboard uses", () => {
    const days = [day("2026-09-21", { kcal: 2400 }), day("2026-09-22", { kcal: 1800 })];
    expect(nutritionPeriod(days, week, TARGET).kcal_score).toBe(macroScore(days, 2400) * 100);
  });

  it("counts days a target was reached (at least 100%) and days within 10%", () => {
    const p = nutritionPeriod(
      [
        day("2026-09-21", { protein: 180, kcal: 2400 }),
        day("2026-09-22", { protein: 200, kcal: 2700 }),
        day("2026-09-23", { protein: 170, kcal: 2200 }),
      ],
      week,
      TARGET,
    );
    expect(p.days_reached!.protein).toBe(2);
    expect(p.days_within!.kcal).toBe(2); // 2400 and 2200 (−8.3 %); 2700 is +12.5 %
  });

  it("names the highest and lowest logged day only when there are two to compare", () => {
    const one = nutritionPeriod([day("2026-09-21")], week, TARGET);
    expect(one.highest).toBeNull();
    const two = nutritionPeriod([day("2026-09-21", { kcal: 1700 }), day("2026-09-22", { kcal: 2600 })], week, TARGET);
    expect(two.highest!.day).toBe("2026-09-22");
    expect(two.lowest!.day).toBe("2026-09-21");
  });

  it("with no target has averages but no adherence", () => {
    const p = nutritionPeriod([day("2026-09-21")], week, null);
    expect(p.avg).not.toBeNull();
    expect(p.adherence).toBeNull();
    expect(p.days_reached).toBeNull();
    expect(p.kcal_score).toBeNull();
  });

  it("treats a zero target for one macro as no target for that macro", () => {
    const p = nutritionPeriod([day("2026-09-21")], week, { ...TARGET, carbs: 0 });
    expect(p.adherence!.carbs.pct).toBeNull();
    expect(p.days_reached!.carbs).toBe(0);
  });
});

// ---------- comparison ----------

describe("nutritionProgress", () => {
  it("compares averages with the previous period when both have logged days", () => {
    const windows = progressWindows("2026-09-26", 7, "2026-01-01");
    const p = nutritionProgress(
      [day("2026-09-15", { kcal: 2000 }), day("2026-09-22", { kcal: 2200 })],
      windows,
      TARGET,
    );
    expect(p.changes!.kcal!.previous).toBe(2000);
    expect(p.changes!.kcal!.pct).toBeCloseTo(10, 9);
  });

  it("has no average comparison when the previous period had no logged day", () => {
    const windows = progressWindows("2026-09-26", 7, "2026-01-01");
    const p = nutritionProgress([day("2026-09-22")], windows, TARGET);
    expect(p.previous!.days_logged).toBe(0);
    expect(p.changes!.kcal).toBeNull();
    expect(p.changes!.days_logged!.delta).toBe(1);
  });

  it("has no comparison at all for all time", () => {
    const windows = progressWindows("2026-09-26", null, "2026-09-01");
    const p = nutritionProgress([day("2026-09-22")], windows, TARGET);
    expect(p.previous).toBeNull();
    expect(p.changes).toBeNull();
  });
});

// ---------- series ----------

describe("nutritionSeries", () => {
  it("one point per day for short windows, with gaps as null — never zero", () => {
    const s = nutritionSeries([day("2026-09-21", { kcal: 1900 })], { start: "2026-09-20", end: "2026-09-22" });
    expect(s.unit).toBe("day");
    expect(s.items).toEqual([
      { start: "2026-09-20", days_logged: 0, kcal: null, protein: null, carbs: null, fat: null },
      { start: "2026-09-21", days_logged: 1, kcal: 1900, protein: 150, carbs: 200, fat: 60 },
      { start: "2026-09-22", days_logged: 0, kcal: null, protein: null, carbs: null, fat: null },
    ]);
  });

  it("weekly buckets average the logged days of each week", () => {
    const s = nutritionSeries(
      [day("2026-08-03", { kcal: 2000 }), day("2026-08-05", { kcal: 2500 })],
      { start: "2026-07-01", end: "2026-09-26" },
    );
    expect(s.unit).toBe("week");
    const aug3 = s.items.find((b) => b.start === "2026-08-03")!;
    expect(aug3.kcal).toBe(2250);
    expect(aug3.days_logged).toBe(2);
  });

  it("monthly buckets for long windows", () => {
    const s = nutritionSeries([day("2026-02-10")], { start: "2025-09-27", end: "2026-09-26" });
    expect(s.unit).toBe("month");
    expect(s.items).toHaveLength(13);
    expect(s.items.find((b) => b.start === "2026-02-01")!.kcal).toBe(2000);
  });
});

// ---------- distribution ----------

describe("macroDistribution", () => {
  it("is the share of calories from each macro", () => {
    // 150 g protein = 600, 200 g carbs = 800, 60 g fat = 540 → 1940 kcal
    expect(macroDistribution({ protein: 150, carbs: 200, fat: 60 })).toEqual({ protein: 31, carbs: 41, fat: 28 });
  });

  it("is null when the grams carry no calories", () => {
    expect(macroDistribution({ protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });
});

// ---------- week ----------

describe("weekNutrition", () => {
  it("is Monday to today against the full week before", () => {
    const w = weekNutrition([day("2026-09-16"), day("2026-09-22"), day("2026-09-23")], "2026-09-24", TARGET);
    expect(w.current.window).toEqual({ start: "2026-09-21", end: "2026-09-24" });
    expect(w.previous.window).toEqual({ start: "2026-09-14", end: "2026-09-20" });
    expect(w.current.days_logged).toBe(2);
    expect(w.previous.days_logged).toBe(1);
  });
});

// ---------- insights ----------

describe("nutritionInsights", () => {
  const windows = progressWindows("2026-09-26", 7, "2026-01-01");
  const logged = (n: number, over: Partial<NutritionDay> = {}) =>
    Array.from({ length: n }, (_, i) => day(`2026-09-${String(20 + i).padStart(2, "0")}`, over));

  it("says only that there is not enough data below the minimum", () => {
    const i = nutritionInsights(nutritionProgress(logged(MIN_INSIGHT_DAYS - 1), windows, TARGET));
    expect(i).toEqual([{ key: "insufficient_data", days_logged: MIN_INSIGHT_DAYS - 1, min: MIN_INSIGHT_DAYS }]);
  });

  it("reports the average intake and how it sits against the target, as a percentage", () => {
    const i = nutritionInsights(nutritionProgress(logged(5, { kcal: 1968 }), windows, TARGET));
    expect(i).toContainEqual({ key: "avg_kcal", value: 1968 });
    const vs = i.find((x) => x.key === "kcal_vs_target") as { pct: number };
    expect(vs.pct).toBeCloseTo(-18, 9);
  });

  it("reports protein target reached on N of M logged days", () => {
    const days = [...logged(4, { protein: 190 }), day("2026-09-25", { protein: 120 })];
    const i = nutritionInsights(nutritionProgress(days, windows, TARGET));
    expect(i).toContainEqual({ key: "protein_reached", days: 4, logged: 5 });
  });

  it("reports how many days of the period were logged", () => {
    const i = nutritionInsights(nutritionProgress(logged(6), windows, TARGET));
    expect(i).toContainEqual({ key: "logging", days: 6, window_days: 7 });
  });

  it("says nothing against a target that does not exist", () => {
    const i = nutritionInsights(nutritionProgress(logged(5), windows, null));
    expect(i.some((x) => x.key === "kcal_vs_target" || x.key === "protein_reached")).toBe(false);
    expect(i).toContainEqual({ key: "avg_kcal", value: 2000 });
  });

  it("reports a significant change against the previous period only when both have enough days", () => {
    const prev = ["2026-09-13", "2026-09-14", "2026-09-15"].map((d) => day(d, { kcal: 2000 }));
    const up = nutritionInsights(nutritionProgress([...prev, ...logged(3, { kcal: 2300 })], windows, TARGET));
    const change = up.find((x) => x.key === "kcal_change") as { pct: number };
    expect(change.pct).toBeCloseTo(15, 9);

    const thin = nutritionInsights(nutritionProgress([day("2026-09-14", { kcal: 2000 }), ...logged(3, { kcal: 2300 })], windows, TARGET));
    expect(thin.some((x) => x.key === "kcal_change")).toBe(false);
  });

  it("stays quiet about small changes", () => {
    const prev = ["2026-09-13", "2026-09-14", "2026-09-15"].map((d) => day(d, { kcal: 2000 }));
    const i = nutritionInsights(nutritionProgress([...prev, ...logged(3, { kcal: 2040 })], windows, TARGET));
    expect(i.some((x) => x.key === "kcal_change")).toBe(false);
  });
});

// ---------- logging completeness ----------

describe("completeness of the diary", () => {
  const window = { start: "2026-09-01", end: "2026-09-30" };

  it("counts days from the first log only, and the rest as no data — never zero calories", () => {
    const p = nutritionPeriod([day("2026-09-21"), day("2026-09-22"), day("2026-09-25")], window, null, { firstDay: "2026-09-21" });
    expect(p.window_days).toBe(30);
    expect(p.tracked_days).toBe(10); // 21st..30th
    expect(p.days_logged).toBe(3);
    expect(p.unlogged_days).toBe(7);
    // the average is over the three logged days, not over ten or thirty
    expect(p.avg!.kcal).toBe(2000);
  });

  it("without a first day the whole window is tracked; a window entirely before it tracks none", () => {
    expect(trackedDays(window, null)).toBe(30);
    expect(trackedDays(window, "2026-08-15")).toBe(30);
    expect(trackedDays(window, "2026-10-02")).toBe(0);
  });

  it("flags one-meal days as possibly incomplete, but never today", () => {
    const p = nutritionPeriod(
      [day("2026-09-28", { meals: 1 }), day("2026-09-29", { meals: 3 }), day("2026-09-30", { meals: 1 })],
      window,
      null,
      { today: "2026-09-30" },
    );
    expect(PARTIAL_DAY_MAX_MEALS).toBe(1);
    expect(p.partial_days).toBe(1);
  });

  it("finds the longest run of consecutive logged days, ignoring zero-calorie days", () => {
    const p = nutritionPeriod(
      [day("2026-09-02"), day("2026-09-03"), day("2026-09-04", { kcal: 0 }), day("2026-09-10"), day("2026-09-11"), day("2026-09-12")],
      window,
      null,
    );
    expect(p.longest_run).toBe(3);
  });

  it("compares days logged and partial days with the previous period", () => {
    const w = progressWindows("2026-09-30", 7, "2026-01-01");
    const p = nutritionProgress(
      [day("2026-09-17"), day("2026-09-20", { meals: 1 }), day("2026-09-25"), day("2026-09-26"), day("2026-09-27")],
      w,
      null,
      { firstDay: "2026-01-01", today: "2026-09-30" },
    );
    expect(p.changes!.days_logged).toMatchObject({ current: 3, previous: 2 });
    expect(p.changes!.partial_days).toMatchObject({ current: 0, previous: 1 });
  });

  it("reports logging against the tracked days, not the days before the first log", () => {
    const w = progressWindows("2026-09-30", 30, "2026-09-26");
    const p = nutritionProgress(
      [day("2026-09-26"), day("2026-09-27"), day("2026-09-28"), day("2026-09-29")],
      w,
      null,
      { firstDay: "2026-09-26", today: "2026-09-30" },
    );
    expect(nutritionInsights(p)).toContainEqual({ key: "logging", days: 4, window_days: 5 });
  });
});

// ---------- entries: meals and label nutrients ----------

function entry(d: string, slot: NutritionEntry["slot"], over: Partial<NutritionEntry> = {}): NutritionEntry {
  return { day: d, slot, kcal: 500, protein: 30, carbs: 50, fat: 15, saturated_fat: 4, sugar: 10, salt: 1, ...over };
}

describe("mealDistribution", () => {
  const window = { start: "2026-09-01", end: "2026-09-30" };

  it("shares logged calories between slots and averages each over the days it was logged", () => {
    const m = mealDistribution(
      [
        entry("2026-09-01", "breakfast", { kcal: 400 }),
        entry("2026-09-01", "lunch", { kcal: 800 }),
        entry("2026-09-02", "lunch", { kcal: 600 }),
        entry("2026-09-02", "lunch", { kcal: 200 }),
      ],
      window,
    );
    expect(m.logged_days).toBe(2);
    expect(m.slots.breakfast).toMatchObject({ days: 1, days_missing: 1 });
    expect(m.slots.breakfast.kcal_share).toBe(20);
    expect(m.slots.lunch.days).toBe(2);
    expect(m.slots.lunch.avg!.kcal).toBe(800); // (800 + 800) / 2 days, not / 3 entries
    expect(m.slots.dinner).toEqual({ days: 0, days_missing: 2, kcal_share: 0, avg: null });
  });

  it("leaves out entries outside the window and days with no calories", () => {
    const m = mealDistribution(
      [entry("2026-08-31", "dinner"), entry("2026-09-05", "snack", { kcal: 0 })],
      window,
    );
    expect(m.logged_days).toBe(0);
    expect(m.slots.snack).toEqual({ days: 0, days_missing: 0, kcal_share: null, avg: null });
  });
});

describe("labelNutrients", () => {
  const window = { start: "2026-09-01", end: "2026-09-30" };

  it("averages over logged days when nearly all calories carry a value", () => {
    const l = labelNutrients(
      [entry("2026-09-01", "lunch", { salt: 2 }), entry("2026-09-02", "lunch", { salt: 3 })],
      window,
    );
    expect(l.nutrients.salt).toEqual({ known_total: 5, avg_known: 2.5, coverage_pct: 100, complete: true });
  });

  it("treats a missing value as unknown: lower coverage, a floor rather than an average", () => {
    const l = labelNutrients(
      [entry("2026-09-01", "lunch", { kcal: 600, sugar: 12 }), entry("2026-09-01", "dinner", { kcal: 400, sugar: null })],
      window,
    );
    expect(l.nutrients.sugar.known_total).toBe(12);
    expect(l.nutrients.sugar.coverage_pct).toBe(60);
    expect(l.nutrients.sugar.complete).toBe(false);
  });

  it("weights coverage by calories, so a zero-calorie drink without a value does not count against it", () => {
    const l = labelNutrients(
      [entry("2026-09-01", "lunch", { kcal: 900 }), entry("2026-09-01", "snack", { kcal: 0, sugar: null })],
      window,
    );
    expect(l.nutrients.sugar.coverage_pct).toBe(100);
    expect(LABEL_COVERAGE_MIN).toBe(90);
  });

  it("compares two periods only when both are complete", () => {
    const now = labelNutrients([entry("2026-09-10", "lunch", { salt: 3 })], window).nutrients.salt;
    const before = labelNutrients([entry("2026-08-10", "lunch", { salt: 2 })], { start: "2026-08-01", end: "2026-08-31" }).nutrients.salt;
    expect(labelNutrientChange(now, before)).toMatchObject({ current: 3, previous: 2, delta: 1 });
    const partial = labelNutrients([entry("2026-08-10", "lunch", { salt: null })], { start: "2026-08-01", end: "2026-08-31" }).nutrients.salt;
    expect(labelNutrientChange(now, partial)).toBeNull();
    expect(labelNutrientChange(now, null)).toBeNull();
  });

  it("is empty with no logged day", () => {
    const l = labelNutrients([], window);
    expect(l.logged_days).toBe(0);
    expect(l.nutrients.salt).toEqual({ known_total: 0, avg_known: null, coverage_pct: null, complete: false });
  });
});
