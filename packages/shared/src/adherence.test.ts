import { describe, expect, test } from "vitest";
import { FORMULA_VERSION, computeAdherence, macroScore } from "./adherence";

// These cases mirror supabase/migrations/20260823000900_functions.sql
// (compute_adherence_snapshots) and PRODUCT_SPEC §7. If SQL and TypeScript
// ever disagree, the coach dashboard and the client app show different numbers
// for the same week — the drift bug packages/shared exists to prevent.

describe("computeAdherence", () => {
  test("weights the four components 40/30/15/15", () => {
    const r = computeAdherence({
      plannedSessions: 4,
      completedSessions: 3,
      daysLogged: 6,
      macroScore: 0.9,
      habitTicks: 10,
      habitScheduled: 14,
      checkinSubmitted: true,
      inactiveDays: 1,
    });

    expect(r.workout).toBe(0.75);
    expect(r.nutrition).toBe(0.874);
    expect(r.habits).toBe(0.714);
    expect(r.overall).toBe(0.819);
    expect(r.signal).toBe("on_track");
  });

  test("scores a solo client against a 3-sessions-a-week heuristic", () => {
    const solo = computeAdherence(inputs({ plannedSessions: 0, completedSessions: 3 }));
    expect(solo.workout).toBe(1);

    const half = computeAdherence(inputs({ plannedSessions: 0, completedSessions: 1 }));
    expect(half.workout).toBe(0.333);
  });

  test("caps the workout ratio at 1 when more sessions are logged than planned", () => {
    const r = computeAdherence(inputs({ plannedSessions: 3, completedSessions: 6 }));
    expect(r.workout).toBe(1);
  });

  test("scores habits as zero when nothing is scheduled", () => {
    const r = computeAdherence(inputs({ habitTicks: 0, habitScheduled: 0 }));
    expect(r.habits).toBe(0);
  });

  test("forces at_risk after five days without logs even on a perfect week", () => {
    const r = computeAdherence({
      plannedSessions: 4,
      completedSessions: 4,
      daysLogged: 7,
      macroScore: 1,
      habitTicks: 14,
      habitScheduled: 14,
      checkinSubmitted: true,
      inactiveDays: 5,
    });

    expect(r.overall).toBe(1);
    expect(r.signal).toBe("at_risk");
  });

  test("drops to needs_attention when the check-in is missing", () => {
    const r = computeAdherence({
      plannedSessions: 4,
      completedSessions: 4,
      daysLogged: 7,
      macroScore: 1,
      habitTicks: 14,
      habitScheduled: 14,
      checkinSubmitted: false,
      inactiveDays: 1,
    });

    expect(r.signal).toBe("needs_attention");
  });

  test("explains the signal in plain language", () => {
    const r = computeAdherence({
      plannedSessions: 4,
      completedSessions: 1,
      daysLogged: 2,
      macroScore: 0.5,
      habitTicks: 7,
      habitScheduled: 14,
      checkinSubmitted: false,
      inactiveDays: 5,
    });

    expect(r.reason).toBe(
      "1/4 workouts · food logged 2/7 days · habits 50% · check-in missed · no logs for 5 days",
    );
  });

  test("stamps the formula version so old snapshots stay interpretable", () => {
    expect(FORMULA_VERSION).toBe(1);
  });
});

describe("macroScore", () => {
  test("averages each logged day's distance from the kcal target", () => {
    expect(macroScore([{ kcal: 2000 }, { kcal: 2400 }], 2000)).toBe(0.9);
  });

  test("floors a wildly over-target day at zero instead of going negative", () => {
    expect(macroScore([{ kcal: 5000 }], 2000)).toBe(0);
  });

  test("scores zero when no day was logged", () => {
    expect(macroScore([], 2000)).toBe(0);
  });
});

function inputs(over: Partial<Parameters<typeof computeAdherence>[0]>) {
  return {
    plannedSessions: 4,
    completedSessions: 2,
    daysLogged: 4,
    macroScore: 0.8,
    habitTicks: 7,
    habitScheduled: 14,
    checkinSubmitted: true,
    inactiveDays: 1,
    ...over,
  };
}
