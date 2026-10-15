import { describe, expect, it } from "vitest";
import { foldActivity, nextWorkoutDay, type ActivityRows } from "./week-activity";

const BUCHAREST = "Europe/Bucharest";

function rows(over: Partial<ActivityRows> = {}): ActivityRows {
  return { sessions: [], foods: [], habitLogs: [], setStamps: [], ...over };
}

describe("foldActivity on the client's calendar", () => {
  // Monday 2026-10-12, 00:30 in Bucharest = Sunday 21:30 UTC
  const mondayNight = "2026-10-11T21:30:00Z";

  it("a workout finished at 00:30 on Monday in Bucharest belongs to the new week", () => {
    const week = foldActivity(
      rows({ sessions: [{ program_day_id: "d1", started_at: "2026-10-11T20:40:00Z", completed_at: mondayNight }] }),
      { today: "2026-10-12", timeZone: BUCHAREST },
    );
    expect(week.completedSessions).toBe(1);
    expect(week.doneDays.has("d1")).toBe(true);
  });

  it("a workout finished Sunday 23:00 in Bucharest is last week's once their Monday has begun", () => {
    // 20:00 UTC = 23:00 Bucharest, still Sunday there
    const sundayLate = { program_day_id: "d1", started_at: "2026-10-11T19:00:00Z", completed_at: "2026-10-11T20:00:00Z" };
    // looked at on Monday 00:30 Bucharest: a new week, nothing done in it yet
    expect(foldActivity(rows({ sessions: [sundayLate] }), { today: "2026-10-12", timeZone: BUCHAREST }).completedSessions).toBe(0);
    // the server's calendar (UTC) was still on Sunday then, and would have counted it in the old week
    expect(foldActivity(rows({ sessions: [sundayLate] }), { today: "2026-10-11", timeZone: "UTC" }).completedSessions).toBe(1);
  });

  it("counts food over the seven days ending on the client's today, logged days only", () => {
    const week = foldActivity(
      rows({
        foods: [
          { date: "2026-10-05", kcal: 2000, received_at: null }, // eight days back: out
          { date: "2026-10-06", kcal: 1800, received_at: null },
          { date: "2026-10-12", kcal: 900, received_at: null },
          { date: "2026-10-12", kcal: 600, received_at: null },
          { date: "2026-10-10", kcal: 0, received_at: null }, // a day, but no calories
        ],
      }),
      { today: "2026-10-12", timeZone: BUCHAREST },
    );
    expect(week.daysLogged).toBe(3);
    expect(week.weekKcal).toEqual([{ kcal: 1800 }, { kcal: 1500 }]);
  });

  it("an open session is never a completed one", () => {
    const week = foldActivity(
      rows({ sessions: [{ program_day_id: "d1", started_at: mondayNight, completed_at: null }] }),
      { today: "2026-10-12", timeZone: BUCHAREST },
    );
    expect(week.completedSessions).toBe(0);
  });

  it("is the same fold whoever asks — Today and the coach pass the client's calendar", () => {
    const input = rows({
      sessions: [{ program_day_id: null, started_at: "2026-10-12T05:00:00Z", completed_at: "2026-10-12T06:00:00Z" }],
      setStamps: ["2026-10-12T05:30:00Z"],
    });
    const calendar = { today: "2026-10-12", timeZone: BUCHAREST };
    expect(foldActivity(input, calendar)).toEqual(foldActivity(input, { ...calendar }));
    expect(foldActivity(input, calendar).lastActivity).toBe("2026-10-12T05:30:00Z");
  });
});

describe("nextWorkoutDay", () => {
  const days = [{ day_id: "a" }, { day_id: "b" }, { day_id: "c" }];

  it("is the first day with nothing completed this week", () => {
    expect(nextWorkoutDay(days, new Set(["a"]))?.day_id).toBe("b");
  });

  it("skips any done day, not only a prefix", () => {
    expect(nextWorkoutDay(days, new Set(["a", "b"]))?.day_id).toBe("c");
    expect(nextWorkoutDay(days, new Set(["b"]))?.day_id).toBe("a");
  });

  it("starts over at the first day once the whole week is done", () => {
    expect(nextWorkoutDay(days, new Set(["a", "b", "c"]))?.day_id).toBe("a");
  });

  it("is null without a program", () => {
    expect(nextWorkoutDay([], new Set())).toBeNull();
  });

  it("a session against a day of another program does not move it", () => {
    expect(nextWorkoutDay(days, new Set(["other-program-day"]))?.day_id).toBe("a");
  });
});
