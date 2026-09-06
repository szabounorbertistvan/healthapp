import { describe, expect, test } from "vitest";
import { pickProgram } from "./programs";

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
