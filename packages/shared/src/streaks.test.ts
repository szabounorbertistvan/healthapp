import { describe, expect, test } from "vitest";
import {
  STREAK_MILESTONES,
  currentStreak,
  getActiveWorkoutDays,
  isActiveDay,
  localDay,
  longestStreak,
  milestonesReached,
  nextMilestone,
  streakCalendar,
  streakRuns,
  streakStatus,
  streakSummary,
  todayIn,
  weekdayIndex,
  type WorkoutDay,
} from "./streaks";

const TZ = "Europe/Bucharest";
const TODAY = "2026-09-13";

/** A completed session at local noon on `day` (Bucharest is UTC+3 in September). */
function session(day: string, over: { completed?: boolean; hour?: number } = {}) {
  const started_at = `${day}T${String((over.hour ?? 12) - 3).padStart(2, "0")}:00:00Z`;
  return { started_at, completed_at: over.completed === false ? null : started_at.replace("T", "T").replace(":00:00Z", ":50:00Z") };
}

function days(...list: string[]): WorkoutDay[] {
  return list.map((day) => ({ day, workouts: 1 }));
}

describe("active workout days", () => {
  test("empty history → no active days", () => {
    expect(getActiveWorkoutDays([], TZ)).toEqual([]);
  });
  test("only completed sessions count", () => {
    expect(getActiveWorkoutDays([session("2026-09-13", { completed: false })], TZ)).toEqual([]);
    expect(getActiveWorkoutDays([session("2026-09-13")], TZ)).toEqual([{ day: "2026-09-13", workouts: 1 }]);
  });
  test("multiple workouts on the same day are one active day, with the count kept", () => {
    const d = getActiveWorkoutDays([session("2026-09-13", { hour: 7 }), session("2026-09-13", { hour: 18 })], TZ);
    expect(d).toEqual([{ day: "2026-09-13", workouts: 2 }]);
    expect(isActiveDay(d, "2026-09-13")).toBe(true);
    expect(isActiveDay(d, "2026-09-12")).toBe(false);
  });
  test("days come back sorted, oldest first", () => {
    expect(getActiveWorkoutDays([session("2026-09-13"), session("2026-09-11")], TZ).map((d) => d.day)).toEqual(["2026-09-11", "2026-09-13"]);
  });
});

describe("timezone boundary", () => {
  test("23:30Z is the next day in Bucharest and still the same day in Los Angeles", () => {
    expect(localDay("2026-09-13T23:30:00Z", "Europe/Bucharest")).toBe("2026-09-14");
    expect(localDay("2026-09-13T23:30:00Z", "America/Los_Angeles")).toBe("2026-09-13");
    expect(localDay("2026-09-13T23:30:00Z", "UTC")).toBe("2026-09-13");
  });
  test("a late-evening workout lands on the user's own day, so the streak does not skip", () => {
    const s = [{ started_at: "2026-09-12T21:30:00Z", completed_at: "2026-09-12T22:20:00Z" }]; // 00:30 on the 13th in Bucharest
    expect(getActiveWorkoutDays(s, "Europe/Bucharest")).toEqual([{ day: "2026-09-13", workouts: 1 }]);
    expect(getActiveWorkoutDays(s, "UTC")).toEqual([{ day: "2026-09-12", workouts: 1 }]);
  });
  test("todayIn follows the zone", () => {
    const now = new Date("2026-09-13T22:30:00Z");
    expect(todayIn("Europe/Bucharest", now)).toBe("2026-09-14");
    expect(todayIn("UTC", now)).toBe("2026-09-13");
  });
  test("an unknown zone falls back instead of throwing", () => {
    expect(localDay("2026-09-13T12:00:00Z", "Mars/Olympus")).toBe("2026-09-13");
  });
});

describe("current streak", () => {
  test("zero workouts → 0", () => {
    expect(currentStreak([], TODAY)).toEqual({ current: 0, streakStart: null });
  });
  test("workout today → 1", () => {
    expect(currentStreak(days(TODAY), TODAY)).toEqual({ current: 1, streakStart: TODAY });
  });
  test("workout yesterday only → 1 (today is still open)", () => {
    expect(currentStreak(days("2026-09-12"), TODAY)).toEqual({ current: 1, streakStart: "2026-09-12" });
  });
  test("today + yesterday → 2", () => {
    expect(currentStreak(days("2026-09-12", TODAY), TODAY).current).toBe(2);
  });
  test("three consecutive days → 3", () => {
    expect(currentStreak(days("2026-09-11", "2026-09-12", TODAY), TODAY)).toEqual({ current: 3, streakStart: "2026-09-11" });
  });
  test("a one-day gap breaks the run", () => {
    // 10, 11, (12 missed), 13 → the streak is only today
    expect(currentStreak(days("2026-09-10", "2026-09-11", TODAY), TODAY)).toEqual({ current: 1, streakStart: TODAY });
  });
  test("two missed days → 0", () => {
    expect(currentStreak(days("2026-09-09", "2026-09-10", "2026-09-11"), TODAY).current).toBe(0);
  });
  test("multiple workouts on one day are still one day", () => {
    const d: WorkoutDay[] = [{ day: "2026-09-12", workouts: 3 }, { day: TODAY, workouts: 2 }];
    expect(currentStreak(d, TODAY).current).toBe(2);
  });
});

describe("longest streak", () => {
  const history = days("2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-20", "2026-09-12", TODAY);
  test("finds the historical record", () => {
    expect(longestStreak(history)).toBe(5);
    expect(streakRuns(history).map((r) => r.length)).toEqual([5, 1, 2]);
  });
  test("current vs longest", () => {
    const s = streakSummary(history, TODAY);
    expect(s.current).toBe(2);
    expect(s.longest).toBe(5);
    expect(s.longestBefore).toBe(5);
  });
  test("when the current streak is the record, longest follows it", () => {
    const s = streakSummary(days("2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", TODAY), TODAY);
    expect(s.current).toBe(6);
    expect(s.longest).toBe(6);
    expect(s.longestBefore).toBe(0);
  });
});

describe("summary", () => {
  test("empty history", () => {
    expect(streakSummary([], TODAY)).toEqual({
      current: 0, longest: 0, activeToday: false, activeYesterday: false, streakStart: null, lastActiveDate: null, longestBefore: 0,
    });
  });
  test("activeToday / activeYesterday / lastActiveDate", () => {
    expect(streakSummary(days(TODAY), TODAY)).toMatchObject({ activeToday: true, activeYesterday: false, lastActiveDate: TODAY });
    expect(streakSummary(days("2026-09-12"), TODAY)).toMatchObject({ activeToday: false, activeYesterday: true, lastActiveDate: "2026-09-12" });
    expect(streakSummary(days("2026-09-01"), TODAY)).toMatchObject({ activeToday: false, activeYesterday: false, current: 0, lastActiveDate: "2026-09-01" });
  });
  test("the documented example", () => {
    const run = Array.from({ length: 12 }, (_, i) => `2026-09-${String(2 + i).padStart(2, "0")}`);
    const old = Array.from({ length: 31 }, (_, i) => `2026-06-${String(1 + i).padStart(2, "0")}`).slice(0, 30).concat("2026-07-01");
    const s = streakSummary(days(...old, ...run), TODAY);
    expect(s).toMatchObject({ current: 12, longest: 31, activeToday: true, activeYesterday: true, streakStart: "2026-09-02", lastActiveDate: TODAY });
  });
});

describe("status after a workout", () => {
  test("nothing today → no event", () => {
    expect(streakStatus(streakSummary(days("2026-09-12"), TODAY))).toEqual({ event: "none", milestone: null });
  });
  test("first day → started", () => {
    expect(streakStatus(streakSummary(days(TODAY), TODAY))).toEqual({ event: "started", milestone: null });
  });
  test("beating the old record → record", () => {
    const s = streakSummary(days("2026-08-01", "2026-08-02", "2026-09-11", "2026-09-12", TODAY), TODAY);
    expect(streakStatus(s)).toEqual({ event: "record", milestone: 3 });
  });
  test("equalling the old record is not a new record", () => {
    const s = streakSummary(days("2026-08-01", "2026-08-02", "2026-08-03", "2026-09-11", "2026-09-12", TODAY), TODAY);
    expect(streakStatus(s)).toEqual({ event: "extended", milestone: 3 });
  });
  test("milestone 3 / 7 / 30 fire on the exact day, and only then", () => {
    expect(streakStatus(streakSummary(days("2026-09-11", "2026-09-12", TODAY), TODAY)).milestone).toBe(3);
    expect(streakStatus(streakSummary(days("2026-09-10", "2026-09-11", "2026-09-12", TODAY), TODAY)).milestone).toBeNull();
    const seven = days("2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", TODAY);
    expect(streakStatus(streakSummary(seven, TODAY)).milestone).toBe(7);
    const thirty = Array.from({ length: 30 }, (_, i) => shift("2026-08-15", i));
    expect(streakStatus(streakSummary(days(...thirty), "2026-09-13")).milestone).toBe(30);
  });
  test("next milestone", () => {
    expect(nextMilestone(0)).toBe(3);
    expect(nextMilestone(7)).toBe(14);
    expect(nextMilestone(365)).toBeNull();
    expect(STREAK_MILESTONES).toEqual([3, 7, 14, 30, 60, 90, 180, 365]);
  });
});

function shift(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

describe("milestones reached", () => {
  test("derived from history, keyed once per (milestone, streak) — no duplicates on re-read", () => {
    const run = Array.from({ length: 8 }, (_, i) => shift("2026-09-06", i)); // 6..13 → 8 days
    const first = milestonesReached(days(...run), TODAY);
    const again = milestonesReached(days(...run), TODAY);
    expect(first).toEqual(again);
    expect(first).toEqual([
      { milestone: 7, reached_on: "2026-09-12", streak_start: "2026-09-06", current: true },
      { milestone: 3, reached_on: "2026-09-08", streak_start: "2026-09-06", current: true },
    ]);
  });
  test("an older streak keeps its own milestones, marked not current", () => {
    const old = Array.from({ length: 3 }, (_, i) => shift("2026-07-01", i));
    const m = milestonesReached(days(...old, TODAY), TODAY);
    expect(m).toEqual([{ milestone: 3, reached_on: "2026-07-03", streak_start: "2026-07-01", current: false }]);
  });
  test("a 30-day streak reaches 3, 7, 14 and 30", () => {
    const run = Array.from({ length: 30 }, (_, i) => shift("2026-08-15", i));
    expect(milestonesReached(days(...run), "2026-09-13").map((m) => m.milestone)).toEqual([30, 14, 7, 3]);
  });
});

describe("calendar", () => {
  test("12 weeks, Monday to Sunday, ending with the week of today", () => {
    const cal = streakCalendar(days(TODAY, "2026-09-01"), TODAY); // 2026-09-13 is a Sunday
    expect(cal).toHaveLength(12);
    expect(cal.every((w) => w.length === 7)).toBe(true);
    expect(cal[11]![0]!.day).toBe("2026-09-07");
    expect(cal[11]![6]!.day).toBe(TODAY);
    expect(cal[0]![0]!.day).toBe("2026-06-22");
    expect(weekdayIndex("2026-09-07")).toBe(0);
    expect(weekdayIndex(TODAY)).toBe(6);
  });
  test("counts land on their day, later days are marked future", () => {
    const cal = streakCalendar([{ day: "2026-09-09", workouts: 2 }], "2026-09-10");
    const week = cal[11]!;
    expect(week.find((d) => d.day === "2026-09-09")).toEqual({ day: "2026-09-09", workouts: 2, future: false });
    expect(week.find((d) => d.day === "2026-09-11")).toEqual({ day: "2026-09-11", workouts: 0, future: true });
  });
});

describe("one definition of an active day", () => {
  test("the streak, the calendar and isActiveDay agree on the same sessions", () => {
    const sessions = [
      session("2026-09-12"),
      session("2026-09-13", { hour: 7 }),
      session("2026-09-13", { hour: 19 }),
      session("2026-09-10", { completed: false }), // abandoned: not a workout day anywhere
    ];
    const d = getActiveWorkoutDays(sessions, TZ);
    expect(d.map((x) => x.day)).toEqual(["2026-09-12", "2026-09-13"]);
    expect(currentStreak(d, TODAY).current).toBe(2);
    expect(isActiveDay(d, "2026-09-10")).toBe(false);
    const cal = streakCalendar(d, TODAY).flat();
    expect(cal.filter((x) => x.workouts > 0).map((x) => x.day)).toEqual(["2026-09-12", "2026-09-13"]);
  });
});
