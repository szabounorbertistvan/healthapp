import { describe, expect, test } from "vitest";
import {
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIODS,
  isLeaderboardMetric,
  isLeaderboardPeriod,
  periodRange,
  rankLeaderboard,
  scoreOf,
  visibleOnLeaderboard,
  type LeaderboardCandidate,
  type SessionRollup,
} from "./leaderboard";
import { getActiveWorkoutDays, localDay } from "./streaks";
import { trainingLoadFromStats } from "./training-load";

const TODAY = "2026-09-16"; // a Wednesday
const WEEK = periodRange("week", TODAY);
const MONTH = periodRange("month", TODAY);
const ALL = periodRange("all", TODAY);

function s(user_id: string, day: string, load = 50, volume_kg = 4000): SessionRollup {
  return { user_id, day, load, volume_kg };
}

function person(user_id: string, created_at = "2026-01-01T00:00:00Z"): LeaderboardCandidate {
  return { user_id, display_name: user_id, username: user_id, avatar_url: null, created_at };
}

describe("periods, on the user's own calendar", () => {
  test("this week is Monday → today", () => {
    expect(WEEK).toEqual({ start: "2026-09-14", end: TODAY });
    expect(periodRange("week", "2026-09-13")).toEqual({ start: "2026-09-07", end: "2026-09-13" }); // a Sunday keeps its week
  });
  test("this month is the calendar month", () => {
    expect(MONTH).toEqual({ start: "2026-09-01", end: TODAY });
  });
  test("all time has no start", () => {
    expect(ALL).toEqual({ start: null, end: TODAY });
  });
  test("timezone boundary: the same instant is a different week in Bucharest and in Los Angeles", () => {
    const instant = "2026-09-13T22:30:00Z"; // Sunday night UTC
    const bucharest = localDay(instant, "Europe/Bucharest"); // Monday 14th
    const la = localDay(instant, "America/Los_Angeles"); // Sunday 13th
    expect(bucharest).toBe("2026-09-14");
    expect(la).toBe("2026-09-13");
    expect(scoreOf([s("u", bucharest)], "workouts", WEEK).score).toBe(1);
    expect(scoreOf([s("u", la)], "workouts", WEEK).score).toBe(0);
  });
});

describe("scores", () => {
  const sessions = [
    s("u", "2026-09-14", 60, 5000),
    s("u", "2026-09-14", 40, 3000), // same day, second session
    s("u", "2026-09-15", 70, 6000),
    s("u", "2026-09-05", 80, 9000), // this month, last week
    s("u", "2026-08-20", 90, 9999), // last month
  ];
  test("training load = Σ load in the window, secondary volume", () => {
    expect(scoreOf(sessions, "training_load", WEEK)).toEqual({ score: 170, secondary: 14000 });
    expect(scoreOf(sessions, "training_load", MONTH)).toEqual({ score: 250, secondary: 23000 });
    expect(scoreOf(sessions, "training_load", ALL)).toEqual({ score: 340, secondary: 32999 });
  });
  test("volume = Σ volume, secondary sessions", () => {
    expect(scoreOf(sessions, "volume", WEEK)).toEqual({ score: 14000, secondary: 3 });
  });
  test("workouts = completed sessions, secondary volume", () => {
    expect(scoreOf(sessions, "workouts", WEEK)).toEqual({ score: 3, secondary: 14000 });
    expect(scoreOf(sessions, "workouts", MONTH).score).toBe(4);
    expect(scoreOf(sessions, "workouts", ALL).score).toBe(5);
  });
  test("active days: two workouts on one day are one day", () => {
    expect(scoreOf(sessions, "active_days", WEEK)).toEqual({ score: 2, secondary: 3 });
  });
  test("nothing in the window → 0 (and so not ranked)", () => {
    expect(scoreOf([s("u", "2026-08-01")], "training_load", WEEK).score).toBe(0);
  });
});

describe("streak metric", () => {
  // 5-day run 3rd..7th, then 14th..16th (3 days, still going)
  const days = ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-14", "2026-09-15", "2026-09-16"];
  const sessions = days.map((d) => s("u", d));
  test("this week = longest run touching the week", () => {
    expect(scoreOf(sessions, "streak", WEEK).score).toBe(3);
  });
  test("this month = longest run touching the month", () => {
    expect(scoreOf(sessions, "streak", MONTH).score).toBe(5);
  });
  test("all time = longest run ever", () => {
    const older = Array.from({ length: 9 }, (_, i) => s("u", `2026-07-${String(10 + i).padStart(2, "0")}`));
    expect(scoreOf([...sessions, ...older], "streak", ALL).score).toBe(9);
    expect(scoreOf([...sessions, ...older], "streak", MONTH).score).toBe(5);
  });
  test("a run that started before the window but reaches into it counts in full", () => {
    const run = ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"].map((d) => s("u", d));
    expect(scoreOf(run, "streak", WEEK).score).toBe(5);
  });
  test("the same active-day definition as the streak engine", () => {
    const raw = [
      { started_at: "2026-09-14T06:00:00Z", completed_at: "2026-09-14T07:00:00Z" },
      { started_at: "2026-09-14T16:00:00Z", completed_at: "2026-09-14T17:00:00Z" },
      { started_at: "2026-09-15T16:00:00Z", completed_at: null }, // abandoned
    ];
    const active = getActiveWorkoutDays(raw, "Europe/Bucharest");
    const rollups = active.flatMap((d) => Array.from({ length: d.workouts }, () => s("u", d.day)));
    expect(scoreOf(rollups, "active_days", WEEK).score).toBe(1);
    expect(scoreOf(rollups, "workouts", WEEK).score).toBe(2);
  });
});

describe("ranking", () => {
  const people = [
    { ...person("maria"), score: 482, secondary: 10 },
    { ...person("andrei"), score: 451, secondary: 10 },
    { ...person("norbert"), score: 427, secondary: 10 },
  ];
  test("score desc, ranks from 1, the viewer flagged", () => {
    const lb = rankLeaderboard(people, "norbert");
    expect(lb.entries.map((r) => [r.rank, r.user_id])).toEqual([[1, "maria"], [2, "andrei"], [3, "norbert"]]);
    expect(lb.me).toMatchObject({ rank: 3, user_id: "norbert", is_current_user: true });
    expect(lb.entries.filter((r) => r.is_current_user)).toHaveLength(1);
  });
  test("deterministic tie-breaking: secondary desc, then seniority, then id", () => {
    const tied = [
      { ...person("b", "2026-02-01T00:00:00Z"), score: 100, secondary: 5 },
      { ...person("a", "2026-02-01T00:00:00Z"), score: 100, secondary: 5 },
      { ...person("c", "2026-01-01T00:00:00Z"), score: 100, secondary: 5 },
      { ...person("d", "2026-03-01T00:00:00Z"), score: 100, secondary: 9 },
    ];
    const once = rankLeaderboard(tied, "x").entries.map((r) => r.user_id);
    const again = rankLeaderboard([...tied].reverse(), "x").entries.map((r) => r.user_id);
    expect(once).toEqual(["d", "c", "a", "b"]);
    expect(again).toEqual(once);
  });
  test("inactive people (score 0) are not ranked at all", () => {
    const lb = rankLeaderboard([...people, { ...person("quiet"), score: 0, secondary: 0 }], "quiet");
    expect(lb.total).toBe(3);
    expect(lb.me).toBeNull();
  });
  test("top 10 plus the viewer's own row below it", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...person(`u${String(i).padStart(2, "0")}`), score: 1000 - i, secondary: 0 }));
    const lb = rankLeaderboard(many, "u26");
    expect(lb.entries).toHaveLength(10);
    expect(lb.entries[9]!.rank).toBe(10);
    expect(lb.me).toMatchObject({ rank: 27, user_id: "u26" });
    expect(lb.total).toBe(40);
  });
  test("a row carries a name, a handle, an avatar and numbers — nothing else", () => {
    const [row] = rankLeaderboard(people, "maria").entries;
    expect(Object.keys(row!).sort()).toEqual(
      ["avatar_url", "created_at", "display_name", "is_current_user", "rank", "score", "secondary", "user_id", "username"].sort(),
    );
  });
});

describe("visibility", () => {
  const follows = new Set(["friend"]);
  test("public is visible to anyone, private only to themselves, followers to followers", () => {
    expect(visibleOnLeaderboard({ user_id: "x", visibility: "public" }, "me", follows)).toBe(true);
    expect(visibleOnLeaderboard({ user_id: "x", visibility: "private" }, "me", follows)).toBe(false);
    expect(visibleOnLeaderboard({ user_id: "me", visibility: "private" }, "me", follows)).toBe(true);
    expect(visibleOnLeaderboard({ user_id: "friend", visibility: "followers" }, "me", follows)).toBe(true);
    expect(visibleOnLeaderboard({ user_id: "x", visibility: "followers" }, "me", follows)).toBe(false);
  });
});

describe("input validation", () => {
  test("only the known metrics and periods pass", () => {
    for (const m of LEADERBOARD_METRICS) expect(isLeaderboardMetric(m)).toBe(true);
    for (const p of LEADERBOARD_PERIODS) expect(isLeaderboardPeriod(p)).toBe(true);
    expect(isLeaderboardMetric("bench_press")).toBe(false);
    expect(isLeaderboardMetric("body_weight")).toBe(false);
    expect(isLeaderboardPeriod("year")).toBe(false);
    expect(isLeaderboardPeriod(null)).toBe(false);
  });
});

/**
 * Training load parity fixtures. supabase/tests/leaderboard.test.sql feeds the
 * same inputs to training_load_score() and expects the same outputs; keep the
 * two tables identical.
 */
export const LOAD_PARITY: { input: Parameters<typeof trainingLoadFromStats>[0]; score: number }[] = [
  { input: { volume_kg: 0, sets: 0, duration_min: null, intensity: null, exercises: 0 }, score: 0 },
  { input: { volume_kg: 4200, sets: 11, duration_min: 61, intensity: 8, exercises: 3 }, score: 50 },
  { input: { volume_kg: 12450, sets: 28, duration_min: 72, intensity: 8.5, exercises: 12 }, score: 78 },
  { input: { volume_kg: 9586, sets: 10, duration_min: 60, intensity: null, exercises: 3 }, score: 59 },
  { input: { volume_kg: 640, sets: 1, duration_min: null, intensity: 7, exercises: 1 }, score: 15 },
  { input: { volume_kg: 20000, sets: 30, duration_min: 400, intensity: 10, exercises: 8 }, score: 89 },
  { input: { volume_kg: 3000, sets: 12, duration_min: 45, intensity: 3, exercises: 4 }, score: 35 },
];

describe("training load parity table", () => {
  test("the fixtures match trainingLoadFromStats()", () => {
    for (const { input, score } of LOAD_PARITY) expect(trainingLoadFromStats(input).score).toBe(score);
  });
});
