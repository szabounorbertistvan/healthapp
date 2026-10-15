import { describe, expect, test } from "vitest";
import {
  consistencySeries,
  goalProgress,
  goalSourceKey,
  kcalOnTargetSeries,
  liftSeries,
  measurementSeries,
  proteinAvgSeries,
  validateGoalInput,
  weeklyWorkoutsSeries,
  type GoalForProgress,
  type GoalInput,
  type GoalMeasurement,
  type GoalSeries,
} from "./goals";
import type { NutritionDay } from "./nutrition-progress";

const TODAY = "2026-10-15"; // a Thursday

function input(over: Partial<GoalInput> = {}): GoalInput {
  return {
    metric: "body_weight",
    direction: "decrease",
    target_value: 75,
    start_value: 82,
    start_date: TODAY,
    target_date: "2027-01-15",
    exercise_id: null,
    measure_key: null,
    ...over,
  };
}

function goal(over: Partial<GoalForProgress> = {}): GoalForProgress {
  return {
    metric: "body_weight",
    direction: "decrease",
    target_value: 75,
    start_value: 82,
    start_date: "2026-09-01",
    target_date: "2027-01-15",
    status: "active",
    ...over,
  };
}

function series(points: [string, number][], missing: GoalSeries["missing"] = "no_measurements"): GoalSeries {
  const pts = points.map(([day, value]) => ({ day, value }));
  return { current: pts.at(-1) ?? null, points: pts, missing: pts.length ? null : missing };
}

function nday(day: string, kcal: number, protein = 120): NutritionDay {
  return { day, kcal, protein, carbs: 200, fat: 70, entries: 3, meals: 3 };
}

// ---------- validation ----------

describe("validateGoalInput", () => {
  test("a well-formed weight-loss goal passes", () => {
    expect(validateGoalInput(input(), TODAY)).toBeNull();
  });

  test("an unknown metric or a direction the metric does not allow is refused", () => {
    expect(validateGoalInput(input({ metric: "happiness" }), TODAY)).toBe("GOAL_METRIC");
    expect(validateGoalInput(input({ metric: "lift_weight", direction: "decrease", exercise_id: "e1", target_value: 100, start_value: 120 }), TODAY)).toBe("GOAL_DIRECTION");
    expect(validateGoalInput(input({ direction: "sideways" }), TODAY)).toBe("GOAL_DIRECTION");
  });

  test("targets outside the plausible range, NaN and Infinity are refused", () => {
    expect(validateGoalInput(input({ target_value: 10 }), TODAY)).toBe("GOAL_TARGET");
    expect(validateGoalInput(input({ target_value: 401 }), TODAY)).toBe("GOAL_TARGET");
    expect(validateGoalInput(input({ target_value: Number.NaN }), TODAY)).toBe("GOAL_TARGET");
    expect(validateGoalInput(input({ target_value: Number.POSITIVE_INFINITY }), TODAY)).toBe("GOAL_TARGET");
    expect(validateGoalInput(input({ metric: "consistency", direction: "increase", target_value: 101, start_value: null }), TODAY)).toBe("GOAL_TARGET");
  });

  test("the target must lie in the goal's direction from the start", () => {
    expect(validateGoalInput(input({ direction: "decrease", start_value: 70, target_value: 75 }), TODAY)).toBe("GOAL_TARGET_VS_START");
    expect(validateGoalInput(input({ direction: "decrease", start_value: 75, target_value: 75 }), TODAY)).toBe("GOAL_TARGET_VS_START");
    expect(validateGoalInput(input({ direction: "increase", start_value: 80, target_value: 85 }), TODAY)).toBeNull();
    expect(validateGoalInput(input({ direction: "increase", start_value: 90, target_value: 85 }), TODAY)).toBe("GOAL_TARGET_VS_START");
  });

  test("an unknown start is allowed; a negative or absurd one is not", () => {
    expect(validateGoalInput(input({ start_value: null }), TODAY)).toBeNull();
    expect(validateGoalInput(input({ start_value: -3 }), TODAY)).toBe("GOAL_START");
    expect(validateGoalInput(input({ start_value: 9000 }), TODAY)).toBe("GOAL_START");
    // zero workouts a week is an honest start
    expect(validateGoalInput(input({ metric: "weekly_workouts", direction: "increase", start_value: 0, target_value: 3 }), TODAY)).toBeNull();
  });

  test("dates: a deadline before the start, a malformed day, a past deadline", () => {
    expect(validateGoalInput(input({ target_date: "2026-09-01" }), TODAY)).toBe("GOAL_DATES");
    expect(validateGoalInput(input({ start_date: "2026-02-30" }), TODAY)).toBe("GOAL_DATES");
    expect(validateGoalInput(input({ start_date: "2026-09-01", target_date: "2026-10-01" }), TODAY)).toBe("GOAL_DEADLINE_PAST");
    // the same past deadline is fine when it is not being set now
    expect(validateGoalInput(input({ start_date: "2026-09-01", target_date: "2026-10-01" }), TODAY, { deadlineFromToday: false })).toBeNull();
    // no deadline at all is fine; a deadline of today is fine
    expect(validateGoalInput(input({ target_date: null }), TODAY)).toBeNull();
    expect(validateGoalInput(input({ target_date: TODAY }), TODAY)).toBeNull();
  });

  test("a lift needs an exercise and a circumference a known key — and nothing else carries them", () => {
    expect(validateGoalInput(input({ metric: "lift_weight", direction: "increase", start_value: 80, target_value: 100 }), TODAY)).toBe("GOAL_EXERCISE");
    expect(validateGoalInput(input({ metric: "lift_weight", direction: "increase", start_value: 80, target_value: 100, exercise_id: "e1" }), TODAY)).toBeNull();
    expect(validateGoalInput(input({ metric: "circumference", start_value: 90, target_value: 84 }), TODAY)).toBe("GOAL_MEASURE");
    expect(validateGoalInput(input({ metric: "circumference", start_value: 90, target_value: 84, measure_key: "ear" }), TODAY)).toBe("GOAL_MEASURE");
    expect(validateGoalInput(input({ metric: "circumference", start_value: 90, target_value: 84, measure_key: "waist" }), TODAY)).toBeNull();
    expect(validateGoalInput(input({ exercise_id: "e1" }), TODAY)).toBe("GOAL_EXERCISE");
    expect(validateGoalInput(input({ measure_key: "waist" }), TODAY)).toBe("GOAL_MEASURE");
  });

  test("the source key separates lifts and circumferences, nothing else", () => {
    expect(goalSourceKey({ metric: "lift_weight", exercise_id: "a" })).not.toBe(goalSourceKey({ metric: "lift_weight", exercise_id: "b" }));
    expect(goalSourceKey({ metric: "body_weight" })).toBe(goalSourceKey({ metric: "body_weight", exercise_id: null, measure_key: null }));
  });
});

// ---------- progress ----------

describe("goalProgress — a goal that counts down (body weight)", () => {
  test("halfway down from the start is 50 %", () => {
    const p = goalProgress(goal(), series([["2026-10-01", 80], ["2026-10-14", 78.5]]), TODAY);
    expect(p.state).toBe("in_progress");
    expect(p.pct).toBe(50);
    expect(p.change).toBeCloseTo(-3.5);
    expect(p.remaining).toBeCloseTo(3.5);
    expect(p.baselineFrom).toBe("set");
  });

  test("gaining instead of losing is off track at 0 %, never negative", () => {
    const p = goalProgress(goal(), series([["2026-10-14", 84]]), TODAY);
    expect(p.state).toBe("off_track");
    expect(p.pct).toBe(0);
    expect(p.change).toBe(2);
  });

  test("past the target is reached at 100 %, never more", () => {
    const p = goalProgress(goal(), series([["2026-10-14", 73]]), TODAY);
    expect(p.state).toBe("reached");
    expect(p.pct).toBe(100);
    expect(p.remaining).toBe(0);
  });

  test("exactly on the target counts as reached", () => {
    expect(goalProgress(goal(), series([["2026-10-14", 75]]), TODAY).state).toBe("reached");
  });
});

describe("goalProgress — a goal that counts up (a lift)", () => {
  const lift = goal({ metric: "lift_weight", direction: "increase", start_value: 80, target_value: 100 });

  test("80 → 90 toward 100 is 50 %", () => {
    expect(goalProgress(lift, series([["2026-10-10", 90]]), TODAY).pct).toBe(50);
  });

  test("a lighter day than the start is off track", () => {
    expect(goalProgress(lift, series([["2026-10-10", 70]]), TODAY).state).toBe("off_track");
  });

  test("lifting the target weight is reached", () => {
    expect(goalProgress(lift, series([["2026-10-10", 102.5]]), TODAY)).toMatchObject({ state: "reached", pct: 100 });
  });
});

describe("goalProgress — missing data and baselines", () => {
  test("no data is no data: no current value, no percentage, the reason kept", () => {
    const p = goalProgress(goal(), series([], "no_measurements"), TODAY);
    expect(p).toMatchObject({ state: "no_data", current: null, pct: null, remaining: null, missing: "no_measurements" });
  });

  test("without a saved start, the first real value since the start date is the baseline", () => {
    const p = goalProgress(goal({ start_value: null }), series([["2026-08-20", 90], ["2026-09-03", 82], ["2026-10-14", 78.5]]), TODAY);
    expect(p.baseline).toBe(82); // not the August value, which predates the goal
    expect(p.baselineFrom).toBe("first_record");
    expect(p.pct).toBe(50);
  });

  test("no start and nothing since the start date: no invented baseline, no percentage", () => {
    const p = goalProgress(goal({ start_value: null, start_date: "2026-10-15" }), series([["2026-10-01", 80]]), TODAY);
    expect(p.state).toBe("no_baseline");
    expect(p.baseline).toBeNull();
    expect(p.pct).toBeNull();
    expect(p.remaining).toBe(5);
  });

  test("a first record already past the target, then back above it: no percentage rather than a nonsense one", () => {
    const p = goalProgress(goal({ start_value: null }), series([["2026-09-02", 74], ["2026-10-14", 77]]), TODAY);
    expect(p.state).toBe("in_progress");
    expect(p.pct).toBeNull();
  });
});

describe("goalProgress — deadlines", () => {
  test("days left counts to the deadline", () => {
    expect(goalProgress(goal({ target_date: "2026-10-25" }), series([["2026-10-14", 80]]), TODAY).daysLeft).toBe(10);
  });

  test("an active goal past its deadline and not reached is overdue", () => {
    const p = goalProgress(goal({ target_date: "2026-10-10" }), series([["2026-10-14", 80]]), TODAY);
    expect(p.overdue).toBe(true);
    expect(p.daysLeft).toBe(-5);
  });

  test("reached, closed, or without a deadline is never overdue", () => {
    expect(goalProgress(goal({ target_date: "2026-10-10" }), series([["2026-10-14", 74]]), TODAY).overdue).toBe(false);
    expect(goalProgress(goal({ target_date: "2026-10-10", status: "abandoned" }), series([["2026-10-14", 80]]), TODAY).overdue).toBe(false);
    expect(goalProgress(goal({ target_date: null }), series([["2026-10-14", 80]]), TODAY).overdue).toBe(false);
  });
});

// ---------- the metrics' real values ----------

describe("measurementSeries", () => {
  const rows: GoalMeasurement[] = [
    { day: "2026-10-01", weight_kg: 80, circumferences: { waist: 90 } },
    { day: "2026-10-05", weight_kg: null, circumferences: { waist: 89 } },
    { day: "2026-10-09", weight_kg: 79, circumferences: {} },
  ];

  test("weight skips weigh-ins that recorded no weight", () => {
    const s = measurementSeries(rows, "body_weight");
    expect(s.points.map((p) => p.value)).toEqual([80, 79]);
    expect(s.current).toEqual({ day: "2026-10-09", value: 79 });
  });

  test("a circumference follows its own key", () => {
    expect(measurementSeries(rows, "circumference", "waist").current).toEqual({ day: "2026-10-05", value: 89 });
  });

  test("no weigh-in at all is missing, not zero", () => {
    expect(measurementSeries([], "body_weight")).toEqual({ current: null, points: [], missing: "no_measurements" });
    expect(measurementSeries(rows, "circumference", "hips").missing).toBe("no_measurements");
  });

  test("an implausible reading is dropped as invalid data", () => {
    const s = measurementSeries([...rows, { day: "2026-10-10", weight_kg: 4000 }], "body_weight");
    expect(s.current?.value).toBe(79);
  });
});

describe("liftSeries", () => {
  const sessions = [
    { day: "2026-10-01", lifts: [{ exercise_id: "bench", weight_kg: 80, reps: 5 }, { exercise_id: "bench", weight_kg: 85, reps: 2 }] },
    { day: "2026-10-08", lifts: [{ exercise_id: "bench", weight_kg: 90, reps: 0 }, { exercise_id: "squat", weight_kg: 140, reps: 5 }] },
    { day: "2026-10-12", lifts: [{ exercise_id: "bench", weight_kg: 87.5, reps: 1 }] },
  ];

  test("the heaviest set with at least one rep, per day, for that exercise only", () => {
    const s = liftSeries(sessions, "bench");
    expect(s.points).toEqual([{ day: "2026-10-01", value: 85 }, { day: "2026-10-12", value: 87.5 }]);
  });

  test("never lifted is missing", () => {
    expect(liftSeries(sessions, "deadlift").missing).toBe("no_lift_sets");
  });
});

describe("weeklyWorkoutsSeries", () => {
  test("four weeks of three workouts is three a week", () => {
    const days = ["2026-09-18", "2026-09-20", "2026-09-22", "2026-09-25", "2026-09-27", "2026-09-29",
      "2026-10-02", "2026-10-04", "2026-10-06", "2026-10-09", "2026-10-11", "2026-10-13"];
    expect(weeklyWorkoutsSeries(days, TODAY, "2026-01-01").current?.value).toBe(3);
  });

  test("a new account is averaged over the weeks it has existed, not four", () => {
    expect(weeklyWorkoutsSeries(["2026-10-13", "2026-10-14"], TODAY, "2026-10-13").current?.value).toBe(2);
  });

  test("a long-time trainee with nothing in four weeks is a real 0", () => {
    expect(weeklyWorkoutsSeries(["2026-05-01"], TODAY, "2026-05-01").current?.value).toBe(0);
  });

  test("never trained is missing, not zero", () => {
    expect(weeklyWorkoutsSeries([], TODAY, null)).toMatchObject({ current: null, missing: "no_workouts" });
  });

  test("the chart has completed weeks only, empty ones kept", () => {
    const s = weeklyWorkoutsSeries(["2026-09-29", "2026-10-14"], TODAY, "2026-09-28");
    // weeks of Sep 28 and Oct 5 are complete; this week (Oct 12) is not on the chart
    expect(s.points).toEqual([{ day: "2026-09-28", value: 1 }, { day: "2026-10-05", value: 0 }]);
  });
});

describe("consistencySeries", () => {
  test("trained in 6 of the last 8 completed weeks is 75 %", () => {
    const days = ["2026-08-18", "2026-08-25", "2026-09-01", "2026-09-15", "2026-09-29", "2026-10-06"];
    const s = consistencySeries(days, TODAY, "2026-01-01");
    expect(s.current?.value).toBe(75);
    expect(s.points).toHaveLength(8);
  });

  test("only weeks since the first session count", () => {
    expect(consistencySeries(["2026-09-29", "2026-10-06"], TODAY, "2026-09-29").current?.value).toBe(100);
  });

  test("under two completed weeks is too little history", () => {
    expect(consistencySeries(["2026-10-08"], TODAY, "2026-10-08").missing).toBe("too_little_history");
  });
});

describe("nutrition goals", () => {
  const days = [
    nday("2026-10-05", 2000, 150), // on target (±10 % of 2000)
    nday("2026-10-07", 2500, 100), // off
    nday("2026-10-09", 1850, 130), // on
    nday("2026-10-10", 0, 0), // a day without calories is not a logged day
    nday("2026-10-15", 400, 20), // today, still being eaten — left out
  ];

  test("share of logged days on target, unlogged days and today left out", () => {
    const s = kcalOnTargetSeries(days, 2000, TODAY);
    expect(s.current?.value).toBe(67); // 2 of 3
    expect(s.points).toHaveLength(3);
  });

  test("no target means nothing to be on target with", () => {
    expect(kcalOnTargetSeries(days, null, TODAY).missing).toBe("no_kcal_target");
    expect(kcalOnTargetSeries(days, 0, TODAY).missing).toBe("no_kcal_target");
  });

  test("fewer than three logged days is too few", () => {
    expect(kcalOnTargetSeries(days.slice(0, 2), 2000, TODAY).missing).toBe("too_few_logged_days");
    expect(proteinAvgSeries(days.slice(0, 2), TODAY).missing).toBe("too_few_logged_days");
  });

  test("average protein over the logged days", () => {
    expect(proteinAvgSeries(days, TODAY).current?.value).toBe(127); // (150 + 100 + 130) / 3
  });

  test("days older than the two-week window are left out", () => {
    const old = [nday("2026-09-01", 2000), nday("2026-09-02", 2000), nday("2026-09-03", 2000)];
    expect(kcalOnTargetSeries(old, 2000, TODAY).missing).toBe("too_few_logged_days");
  });
});
