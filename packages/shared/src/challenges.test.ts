import { describe, expect, test } from "vitest";
import {
  CHALLENGE_MILESTONES,
  CHALLENGE_TYPES,
  canJoin,
  challengeCategory,
  challengeDurationBucket,
  challengePct,
  challengeStatus,
  challengeUnit,
  daysRemaining,
  isChallengeComplete,
  isChallengeDifficulty,
  isChallengeType,
  matchesChallengeFilter,
  challengeMilestonesReached,
  normalizeChallengeFilter,
  requiresExercise,
} from "./challenges";

// Progress itself (every type), ranking and ties are computed in SQL —
// challenge_value() / challenge_leaderboard() — and pinned by
// supabase/tests/advanced_challenges.test.sql. What lives here is what the
// page decides from those numbers.

const september = { start_date: "2026-09-01", end_date: "2026-09-30" };

describe("challengePct / isChallengeComplete", () => {
  test("zero progress", () => {
    expect(challengePct(0, 10)).toBe(0);
    expect(isChallengeComplete(0, 10)).toBe(false);
  });
  test("partial progress is exact — rounding is the page's job", () => {
    expect(challengePct(45_200, 50_000)).toBe(90.4);
    expect(challengePct(2, 3)).toBe((2 * 100) / 3);
  });
  test("exactly at target", () => {
    expect(challengePct(10, 10)).toBe(100);
    expect(isChallengeComplete(10, 10)).toBe(true);
  });
  test("over target keeps its real value and stays complete", () => {
    expect(challengePct(14, 10)).toBe(140);
    expect(isChallengeComplete(14, 10)).toBe(true);
  });
  test("a zero or missing target has no percentage and is never complete", () => {
    expect(challengePct(5, 0)).toBeNull();
    expect(challengePct(Number.NaN, 10)).toBeNull();
    expect(isChallengeComplete(5, 0)).toBe(false);
  });
});

describe("challengeMilestonesReached — mirrors challenge_sync()", () => {
  test("the four steps", () => {
    expect(CHALLENGE_MILESTONES).toEqual([25, 50, 75, 100]);
  });
  test("none at zero, the ones passed when partial, all when over", () => {
    expect(challengeMilestonesReached(0, 3)).toEqual([]);
    expect(challengeMilestonesReached(2, 3)).toEqual([25, 50]);
    expect(challengeMilestonesReached(1025, 1000)).toEqual([25, 50, 75, 100]);
  });
  test("a boundary is reached exactly at it — no division, so 3 of 12 is 25 %", () => {
    expect(challengeMilestonesReached(3, 12)).toEqual([25]);
    expect(challengeMilestonesReached(2.999, 12)).toEqual([]);
  });
  test("nothing for a zero target", () => {
    expect(challengeMilestonesReached(5, 0)).toEqual([]);
  });
});

describe("challengeStatus / daysRemaining / canJoin", () => {
  test("active inside the window", () => {
    expect(challengeStatus(september, "2026-09-12", false)).toBe("active");
    expect(daysRemaining("2026-09-30", "2026-09-12")).toBe(19);
    expect(canJoin(september, "2026-09-12")).toBe(true);
  });
  test("upcoming before it starts", () => {
    expect(challengeStatus(september, "2026-08-20", false)).toBe("upcoming");
    expect(canJoin(september, "2026-08-20")).toBe(true);
  });
  test("expired: ended without completion, no joining", () => {
    expect(challengeStatus(september, "2026-10-01", false)).toBe("ended");
    expect(daysRemaining("2026-09-30", "2026-10-01")).toBe(0);
    expect(canJoin(september, "2026-10-01")).toBe(false);
  });
  test("completed wins over the calendar", () => {
    expect(challengeStatus(september, "2026-10-15", true)).toBe("completed");
    expect(challengeStatus(september, "2026-09-12", true)).toBe("completed");
  });
  test("the last day still counts as one remaining, and still accepts joins", () => {
    expect(daysRemaining("2026-09-30", "2026-09-30")).toBe(1);
    expect(canJoin(september, "2026-09-30")).toBe(true);
  });
  test("the first day is active, not upcoming", () => {
    expect(challengeStatus(september, "2026-09-01", false)).toBe("active");
  });
  test("a window across the October DST change is counted in calendar days, not hours", () => {
    expect(daysRemaining("2026-10-31", "2026-10-24")).toBe(8);
  });
});

describe("types and metadata", () => {
  test("the four original types and the five new ones", () => {
    expect(CHALLENGE_TYPES).toEqual([
      "workouts", "training_load", "volume", "active_days",
      "exercise_sessions", "strength_gain", "check_ins", "nutrition_days", "habit_completions",
    ]);
    expect(isChallengeType("strength_gain")).toBe(true);
    expect(isChallengeType("steps")).toBe(false);
  });
  test("each type has a unit and a category", () => {
    expect(challengeUnit("volume")).toBe("kg");
    expect(challengeUnit("strength_gain")).toBe("percent");
    expect(challengeUnit("nutrition_days")).toBe("days");
    expect(challengeCategory("strength_gain")).toBe("strength");
    expect(challengeCategory("nutrition_days")).toBe("nutrition");
    expect(challengeCategory("habit_completions")).toBe("habits");
    expect(challengeCategory("workouts")).toBe("training");
    for (const t of CHALLENGE_TYPES) {
      expect(challengeUnit(t)).toBeTruthy();
      expect(challengeCategory(t)).toBeTruthy();
    }
  });
  test("only the exercise types need an exercise — the constraint challenges_exercise_matches_type", () => {
    expect(CHALLENGE_TYPES.filter(requiresExercise)).toEqual(["exercise_sessions", "strength_gain"]);
  });
  test("difficulty", () => {
    expect(isChallengeDifficulty("hard")).toBe(true);
    expect(isChallengeDifficulty("insane")).toBe(false);
  });
  test("duration buckets by the window's length in days", () => {
    expect(challengeDurationBucket({ start_date: "2026-09-01", end_date: "2026-09-07" })).toBe("week");
    expect(challengeDurationBucket(september)).toBe("month");
    expect(challengeDurationBucket({ start_date: "2026-09-01", end_date: "2026-12-31" })).toBe("long");
  });
});

describe("discovery filters", () => {
  const card = {
    title: "30 Day Consistency", type: "workouts" as const, difficulty: "medium" as const,
    start_date: "2026-09-01", end_date: "2026-09-30", status: "active" as const,
  };
  test("drop anything unknown", () => {
    expect(normalizeChallengeFilter({ status: "weird", category: "x", difficulty: "insane", duration: "forever", q: "  " }))
      .toEqual({ status: null, category: null, difficulty: null, duration: null, q: null });
  });
  test("a card matches when every set filter matches", () => {
    expect(matchesChallengeFilter(card, normalizeChallengeFilter({}))).toBe(true);
    expect(matchesChallengeFilter(card, normalizeChallengeFilter({ q: "consist", category: "training", difficulty: "medium", duration: "month", status: "active" }))).toBe(true);
    expect(matchesChallengeFilter(card, normalizeChallengeFilter({ category: "nutrition" }))).toBe(false);
    expect(matchesChallengeFilter(card, normalizeChallengeFilter({ status: "completed" }))).toBe(false);
  });
  test("'completed' as a filter also covers challenges that ended", () => {
    expect(matchesChallengeFilter({ ...card, status: "ended" }, normalizeChallengeFilter({ status: "completed" }))).toBe(true);
  });
});
