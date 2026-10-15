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

  test("an activated program wins over one edited more recently", () => {
    const active = { id: "active", coach_id: null, updated_at: "2026-01-01T00:00:00Z", activated_at: "2026-01-01T00:00:00Z" };
    const edited = { id: "edited", coach_id: null, updated_at: "2026-03-01T00:00:00Z", activated_at: null };
    expect(pickProgram([active, edited], false)?.id).toBe("active");
  });

  test("the last activation decides between two activated programs", () => {
    const first = { id: "first", coach_id: null, updated_at: "2026-05-01T00:00:00Z", activated_at: "2026-01-01T00:00:00Z" };
    const second = { id: "second", coach_id: null, updated_at: "2026-02-01T00:00:00Z", activated_at: "2026-02-01T00:00:00Z" };
    expect(pickProgram([first, second], false)?.id).toBe("second");
  });

  test("activation never lets the client's own program beat an active coach's", () => {
    const own = { id: "own", coach_id: null, updated_at: "2026-06-01T00:00:00Z", activated_at: "2026-06-01T00:00:00Z" };
    expect(pickProgram([own, coachProgram], true)?.id).toBe("coach");
  });

  test("activation is compared within the coach's programs too", () => {
    const block1 = { id: "b1", coach_id: "c1", updated_at: "2026-04-01T00:00:00Z", activated_at: "2026-03-01T00:00:00Z" };
    const block2 = { id: "b2", coach_id: "c1", updated_at: "2026-02-01T00:00:00Z", activated_at: "2026-03-15T00:00:00Z" };
    expect(pickProgram([block1, block2], true)?.id).toBe("b2");
  });

  test("rows without the field (nutrition plans) keep the newest-edit rule", () => {
    const a = { id: "a", coach_id: null, updated_at: "2026-01-01T00:00:00Z" };
    const b = { id: "b", coach_id: null, updated_at: "2026-01-02T00:00:00Z" };
    expect(pickProgram([a, b], false)?.id).toBe("b");
  });
});
