import { describe, expect, test } from "vitest";
import {
  canJoin,
  challengeProgress,
  challengeStatus,
  daysRemaining,
  isChallengeComplete,
  isChallengeType,
  progressPct,
  rankParticipants,
  type ChallengeActivity,
} from "./challenges";

const september = { start_date: "2026-09-01", end_date: "2026-09-30" };

const activity: ChallengeActivity = {
  sessions: [
    { day: "2026-08-30", load: 70, volume_kg: 9000 }, // before the window
    { day: "2026-09-02", load: 61, volume_kg: 9586 },
    { day: "2026-09-04", load: 40, volume_kg: 2640 },
    { day: "2026-09-07", load: 61, volume_kg: 9400 },
    { day: "2026-09-07", load: 39, volume_kg: 2532 }, // two sessions, one day
    { day: "2026-10-01", load: 80, volume_kg: 12000 }, // after the window
  ],
  active_days: ["2026-09-02", "2026-09-03", "2026-09-07", "2026-09-15", "2026-08-31"],
};

describe("challengeProgress", () => {
  test("workouts counts completed sessions inside the window", () => {
    expect(challengeProgress("workouts", activity, september)).toBe(4);
  });
  test("training_load sums session scores", () => {
    expect(challengeProgress("training_load", activity, september)).toBe(201);
  });
  test("volume sums kilograms", () => {
    expect(challengeProgress("volume", activity, september)).toBe(24158);
  });
  test("active_days counts distinct days from activity and sessions, never double", () => {
    // 02, 03, 07, 15 from active_days (+04 from a session; 07 already counted)
    expect(challengeProgress("active_days", activity, september)).toBe(5);
  });
  test("nothing logged is 0 for every type", () => {
    const empty = { sessions: [], active_days: [] };
    for (const type of ["workouts", "training_load", "volume", "active_days"] as const) {
      expect(challengeProgress(type, empty, september)).toBe(0);
    }
  });
});

describe("progressPct / isChallengeComplete", () => {
  test("0 progress", () => {
    expect(progressPct(0, 10)).toBe(0);
    expect(isChallengeComplete(0, 10)).toBe(false);
  });
  test("partial progress rounds to a whole percent", () => {
    expect(progressPct(7, 10)).toBe(70);
    expect(progressPct(318, 500)).toBe(64);
    expect(progressPct(72_400, 100_000)).toBe(72);
  });
  test("100% exactly at target", () => {
    expect(progressPct(10, 10)).toBe(100);
    expect(isChallengeComplete(10, 10)).toBe(true);
  });
  test("over target clamps to 100 and stays complete", () => {
    expect(progressPct(14, 10)).toBe(100);
    expect(isChallengeComplete(14, 10)).toBe(true);
  });
  test("a zero target is never complete", () => {
    expect(progressPct(5, 0)).toBe(0);
    expect(isChallengeComplete(5, 0)).toBe(false);
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
});

describe("rankParticipants", () => {
  test("orders by value, highest first, with the user's own row findable", () => {
    const ranked = rankParticipants([
      { name: "Andrei", value: 318, me: true },
      { name: "Alex", value: 482, me: false },
      { name: "Mihai", value: 421, me: false },
    ]);
    expect(ranked.map((r) => `#${r.rank} ${r.name} — ${r.value}`)).toEqual([
      "#1 Alex — 482",
      "#2 Mihai — 421",
      "#3 Andrei — 318",
    ]);
    expect(ranked.find((r) => r.me)?.rank).toBe(3);
  });
  test("ties share a rank and the next rank skips", () => {
    const ranked = rankParticipants([
      { name: "a", value: 10 },
      { name: "b", value: 20 },
      { name: "c", value: 20 },
      { name: "d", value: 0 },
    ]);
    expect(ranked.map((r) => [r.name, r.rank])).toEqual([["b", 1], ["c", 1], ["a", 3], ["d", 4]]);
  });
  test("empty and single-entry boards", () => {
    expect(rankParticipants([])).toEqual([]);
    expect(rankParticipants([{ value: 5 }])).toEqual([{ value: 5, rank: 1 }]);
  });
});

describe("isChallengeType", () => {
  test("accepts the four v1 types only", () => {
    expect(isChallengeType("workouts")).toBe(true);
    expect(isChallengeType("active_days")).toBe(true);
    expect(isChallengeType("steps")).toBe(false);
  });
});
