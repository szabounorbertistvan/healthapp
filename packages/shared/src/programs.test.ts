import { describe, expect, test } from "vitest";
import { pickProgram, estimateDayMinutes } from "./programs";

const coachProgram = { id: "coach", coach_id: "c1", updated_at: "2026-01-01T00:00:00Z" };
const soloProgram = { id: "solo", coach_id: null, updated_at: "2026-06-01T00:00:00Z" };

describe("pickProgram", () => {
  test("prefers the coach's program while a coach is active", () => {
    expect(pickProgram([soloProgram, coachProgram], true)?.id).toBe("coach");
  });

  test("falls back to the client's own when the coach published nothing", () => {
    expect(pickProgram([soloProgram], true)?.id).toBe("solo");
  });

  test("ignores the coach's program once the relationship has ended", () => {
    expect(pickProgram([soloProgram, coachProgram], false)?.id).toBe("solo");
  });

  test("returns null when the client has nothing at all", () => {
    expect(pickProgram([], false)).toBeNull();
  });

  test("breaks ties on updated_at, newest first", () => {
    const older = { id: "older", coach_id: null, updated_at: "2026-01-01T00:00:00Z" };
    const newer = { id: "newer", coach_id: null, updated_at: "2026-02-01T00:00:00Z" };
    expect(pickProgram([older, newer], false)?.id).toBe("newer");
  });
});

describe("estimateDayMinutes", () => {
  test("charges rest plus work per set and rounds to minutes", () => {
    // 4×(90+40) + 3×(60+40) = 520 + 300 = 820 s ≈ 14 min
    expect(estimateDayMinutes([{ sets: 4, rest_seconds: 90 }, { sets: 3, rest_seconds: 60 }])).toBe(14);
  });
  test("falls back to 90 s rest when the coach left it blank", () => {
    expect(estimateDayMinutes([{ sets: 3, rest_seconds: null }])).toBe(7); // 3×130 = 390 s
  });
  test("never reports zero for a day with a single short set", () => {
    expect(estimateDayMinutes([{ sets: 1, rest_seconds: 0 }])).toBe(1);
  });
});
