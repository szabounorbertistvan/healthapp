import { describe, expect, test } from "vitest";
import {
  compareWeeks,
  delta,
  deltaOrNull,
  inWeek,
  previousWeek,
  weekOf,
  weekStats,
  weeklyInsights,
  type WeeklyInput,
  type WeeklySession,
} from "./weekly-summary";

const week = { start: "2026-09-07", end: "2026-09-13" };
const prev = { start: "2026-08-31", end: "2026-09-06" };

function session(day: string, over: Partial<WeeklySession> = {}): WeeklySession {
  return {
    day, duration_min: 60, load: 60, volume_kg: 8000, sets: 10, exercises: ["Squat", "Bench"], prs: [], ...over,
  };
}

function input(over: Partial<WeeklyInput> = {}): WeeklyInput {
  return {
    week,
    sessions: [],
    food_days: [],
    target: null,
    measurements: [],
    active_days: [],
    planned_workouts: 0,
    streak_days: 0,
    ...over,
  };
}

describe("week boundaries", () => {
  test("Monday to Sunday around any day of the week", () => {
    expect(weekOf("2026-09-09")).toEqual(week); // a Wednesday
    expect(weekOf("2026-09-07")).toEqual(week); // the Monday itself
    expect(weekOf("2026-09-13")).toEqual(week); // the Sunday
  });
  test("previous week is the seven days before", () => {
    expect(previousWeek(week)).toEqual(prev);
  });
  test("inWeek is inclusive at both ends", () => {
    expect(inWeek("2026-09-07", week)).toBe(true);
    expect(inWeek("2026-09-13", week)).toBe(true);
    expect(inWeek("2026-09-06", week)).toBe(false);
    expect(inWeek("2026-09-14", week)).toBe(false);
  });
  test("crosses a month boundary correctly", () => {
    expect(weekOf("2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
});

describe("training stats", () => {
  const stats = weekStats(
    input({
      sessions: [
        session("2026-09-07", { duration_min: 62, load: 61, volume_kg: 9586, sets: 10, prs: [{ exercise: "Squat", weight_kg: 82, reps: 8 }] }),
        session("2026-09-09", { duration_min: 48, load: 40, volume_kg: 2640, sets: 7, exercises: ["Bench", "OHP"] }),
        session("2026-09-11", { duration_min: null, load: 61, volume_kg: 9400, sets: 10, prs: [{ exercise: "Leg Press", weight_kg: 145, reps: 12 }] }),
        session("2026-09-06", { load: 99, volume_kg: 99999 }), // previous week — excluded
      ],
    }),
  );
  test("counts workouts inside the week only", () => expect(stats.training.workouts).toBe(3));
  test("sums duration, treating unknown as 0", () => expect(stats.training.duration_min).toBe(110));
  test("sums training load", () => expect(stats.training.load).toBe(162));
  test("sums volume", () => expect(stats.training.volume_kg).toBe(21626));
  test("sums sets", () => expect(stats.training.sets).toBe(27));
  test("counts distinct exercises across sessions", () => expect(stats.training.exercises).toBe(3));
  test("counts PRs and keeps the lifts", () => {
    expect(stats.training.prs).toBe(2);
    expect(stats.training.pr_lifts.map((p) => p.exercise)).toEqual(["Squat", "Leg Press"]);
  });
  test("zero workouts is all zeros, not an error", () => {
    const empty = weekStats(input());
    expect(empty.training).toEqual({ workouts: 0, duration_min: 0, load: 0, volume_kg: 0, exercises: 0, sets: 0, prs: 0, pr_lifts: [] });
  });
});

describe("nutrition stats", () => {
  const days = [
    { day: "2026-09-07", kcal: 2100, protein: 170, carbs: 220, fat: 70 },
    { day: "2026-09-08", kcal: 2260, protein: 172, carbs: 240, fat: 75 },
    { day: "2026-09-10", kcal: 1800, protein: 150, carbs: 180, fat: 60 },
    { day: "2026-09-05", kcal: 3000, protein: 10, carbs: 10, fat: 10 }, // previous week
  ];
  test("averages over logged days of the week", () => {
    const s = weekStats(input({ food_days: days }));
    expect(s.nutrition.days_logged).toBe(3);
    expect(s.nutrition.avg).toEqual({ kcal: 2053, protein: 164, carbs: 213, fat: 68 });
  });
  test("adherence against the plan's kcal target, via macroScore", () => {
    const s = weekStats(input({ food_days: days, target: { kcal: 2000, protein: 160, carbs: 200, fat: 65 } }));
    // per day: 0.95, 0.87, 0.90 → 0.907
    expect(s.nutrition.adherence_pct).toBe(91);
  });
  test("no logs → no averages and no adherence (never invented)", () => {
    const s = weekStats(input({ target: { kcal: 2000, protein: 160, carbs: 200, fat: 65 } }));
    expect(s.nutrition.avg).toBeNull();
    expect(s.nutrition.adherence_pct).toBeNull();
  });
  test("logs but no plan → averages, no adherence", () => {
    const s = weekStats(input({ food_days: days }));
    expect(s.nutrition.avg).not.toBeNull();
    expect(s.nutrition.adherence_pct).toBeNull();
  });
});

describe("progress stats", () => {
  test("weight change is last minus first reading of the week", () => {
    const s = weekStats(
      input({
        measurements: [
          { day: "2026-09-07", weight_kg: 112.8, circumferences: { waist: 94 } },
          { day: "2026-09-10", weight_kg: 112.5, circumferences: {} },
          { day: "2026-09-13", weight_kg: 112.2, circumferences: { waist: 93.2, chest: 104 } },
        ],
      }),
    );
    expect(s.progress.weight).toEqual({ start: 112.8, end: 112.2, delta: -0.6 });
    expect(s.progress.waist).toEqual({ start: 94, end: 93.2, delta: -0.8 });
    // chest was measured once — no change reported, nothing interpolated
    expect(s.progress.others).toEqual({});
  });
  test("other circumferences measured twice are reported", () => {
    const s = weekStats(
      input({
        measurements: [
          { day: "2026-09-07", weight_kg: null, circumferences: { hips: 100 } },
          { day: "2026-09-12", weight_kg: null, circumferences: { hips: 99.4 } },
        ],
      }),
    );
    expect(s.progress.weight).toBeNull();
    expect(s.progress.others).toEqual({ hips: { start: 100, end: 99.4, delta: -0.6 } });
  });
  test("a single measurement gives no change", () => {
    const s = weekStats(input({ measurements: [{ day: "2026-09-09", weight_kg: 80, circumferences: { waist: 90 } }] }));
    expect(s.progress.weight).toBeNull();
    expect(s.progress.waist).toBeNull();
  });
});

describe("consistency", () => {
  test("active days merge activity and workout days; completion against the plan", () => {
    const s = weekStats(
      input({
        sessions: [session("2026-09-07"), session("2026-09-09"), session("2026-09-11"), session("2026-09-12")],
        active_days: ["2026-09-07", "2026-09-08", "2026-09-13", "2026-09-06"],
        planned_workouts: 5,
        streak_days: 3,
      }),
    );
    expect(s.consistency).toEqual({ active_days: 6, workout_days: 4, planned_workouts: 5, completion_pct: 80, streak_days: 3 });
  });
  test("no planned workouts → no completion percentage", () => {
    expect(weekStats(input({ sessions: [session("2026-09-07")] })).consistency.completion_pct).toBeNull();
  });
  test("more than planned caps at 100", () => {
    const s = weekStats(input({ sessions: [session("2026-09-07"), session("2026-09-08"), session("2026-09-09")], planned_workouts: 2 }));
    expect(s.consistency.completion_pct).toBe(100);
  });
});

describe("delta", () => {
  test("positive change", () => {
    expect(delta(318, 287)).toEqual({ current: 318, previous: 287, delta: 31, pct: 10.8, direction: "up" });
    expect(delta(4, 3).pct).toBe(33.3);
  });
  test("negative change", () => {
    expect(delta(27800, 31250)).toMatchObject({ pct: -11, direction: "down" });
  });
  test("stable within the band", () => {
    expect(delta(290, 287).direction).toBe("stable");
    expect(delta(287, 287)).toMatchObject({ delta: 0, pct: 0, direction: "stable" });
  });
  test("previous week with no data: no percentage", () => {
    expect(delta(4, 0)).toEqual({ current: 4, previous: 0, delta: 4, pct: null, direction: "up" });
    expect(delta(0, 0).direction).toBe("stable");
  });
  test("nullable metrics compare only when the current week has a value", () => {
    expect(deltaOrNull(null, 2000)).toBeNull();
    expect(deltaOrNull(2100, null)).toMatchObject({ current: 2100, previous: 0, pct: null });
  });
});

describe("compareWeeks", () => {
  const current = weekStats(input({ sessions: [session("2026-09-07"), session("2026-09-09"), session("2026-09-11"), session("2026-09-12")] }));
  const previous = weekStats(input({ week: prev, sessions: [session("2026-09-01"), session("2026-09-03"), session("2026-09-05")] }));
  const c = compareWeeks(current, previous);
  test("current vs previous, per metric", () => {
    expect(c.training.workouts).toMatchObject({ current: 4, previous: 3, pct: 33.3, direction: "up" });
    expect(c.training.load).toMatchObject({ current: 240, previous: 180, pct: 33.3 });
    expect(c.training.volume_kg).toMatchObject({ current: 32000, previous: 24000 });
    expect(c.nutrition.kcal).toBeNull();
  });
  test("produces insights", () => {
    expect(c.insights[0]).toEqual({ key: "load_up", pct: 33.3 });
  });
});

describe("weeklyInsights", () => {
  const base = (cur: Partial<WeeklyInput>, prv: Partial<WeeklyInput> = {}) =>
    compareWeeks(weekStats(input(cur)), weekStats(input({ week: prev, ...prv }))).insights;

  test("no data at all → the keep-training nudge, alone", () => {
    expect(base({})).toEqual([{ key: "no_data" }]);
  });
  test("a significant load increase leads", () => {
    const i = base({ sessions: [session("2026-09-07", { load: 80 }), session("2026-09-09", { load: 80 })] }, { sessions: [session("2026-09-01", { load: 60 }), session("2026-09-03", { load: 60 })] });
    expect(i[0]).toEqual({ key: "load_up", pct: 33.3 });
  });
  test("more workouts when load did not move significantly", () => {
    const i = base({ sessions: [session("2026-09-07", { load: 50 }), session("2026-09-09", { load: 50 })] }, { sessions: [session("2026-09-01", { load: 95 })] });
    expect(i[0]).toEqual({ key: "more_workouts", count: 1 });
  });
  test("PRs are mentioned, and a volume drop", () => {
    const i = base(
      { sessions: [session("2026-09-07", { load: 60, volume_kg: 5000, prs: [{ exercise: "Bench", weight_kg: 110, reps: 8 }, { exercise: "Squat", weight_kg: 140, reps: 5 }] })] },
      { sessions: [session("2026-09-01", { load: 60, volume_kg: 8000 })] },
    );
    expect(i).toEqual([
      { key: "prs", count: 2 },
      { key: "volume_down", pct: 37.5 },
    ]);
  });
  test("never more than three observations", () => {
    const i = base(
      {
        sessions: [session("2026-09-07", { load: 90, volume_kg: 9000, prs: [{ exercise: "Bench", weight_kg: 100, reps: 5 }] }), session("2026-09-09", { load: 90 })],
        planned_workouts: 2,
        food_days: [{ day: "2026-09-07", kcal: 2000, protein: 1, carbs: 1, fat: 1 }],
        target: { kcal: 2000, protein: 1, carbs: 1, fat: 1 },
        measurements: [
          { day: "2026-09-07", weight_kg: 80, circumferences: {} },
          { day: "2026-09-13", weight_kg: 79.4, circumferences: {} },
        ],
      },
      { sessions: [session("2026-09-01", { load: 60 })] },
    );
    expect(i).toHaveLength(3);
    expect(i.map((x) => x.key)).toEqual(["load_up", "prs", "all_planned_done"]);
  });
  test("a fewer-workouts week says so only when last week had any", () => {
    const i = base({ sessions: [session("2026-09-07", { load: 50 })], active_days: ["2026-09-08"] }, { sessions: [session("2026-09-01", { load: 52 }), session("2026-09-03", { load: 52 })] });
    expect(i[0]).toEqual({ key: "load_down", pct: 51.9 });
  });
  test("weeklyInsights is deterministic for identical input", () => {
    const a = base({ sessions: [session("2026-09-07")] });
    const b = base({ sessions: [session("2026-09-07")] });
    expect(a).toEqual(b);
    expect(weeklyInsights).toBeTypeOf("function");
  });
});
