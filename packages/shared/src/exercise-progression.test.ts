import { describe, expect, test } from "vitest";
import {
  analyzeProgression,
  atRepCeiling,
  isWorkingSet,
  PROGRESSION_RULES,
  repCeiling,
  sessionPerformance,
  type ProgressionSession,
  type ProgressionSet,
} from "./exercise-progression";
import { estimated1RMExact, isPersonalRecord } from "./prs";
import { relevantOneRm, ONE_RM_MAX_REPS } from "./exercise-analytics";
import { displayToKg } from "./units";

const TODAY = "2026-10-15";

function day(daysAgo: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** One session `daysAgo` days back with the given working sets [weight, reps]. */
function s(id: string, daysAgo: number, sets: [number, number][], extra: Partial<ProgressionSet> = {}): ProgressionSession {
  return { session_id: id, day: day(daysAgo), sets: sets.map(([weight_kg, reps]) => ({ weight_kg, reps, ...extra })) };
}

/** A weekly history, oldest first: each entry is that week's sets. */
function weekly(weeks: [number, number][][], target?: string): ProgressionSession[] {
  return weeks.map((sets, i) => s(`w${i}`, (weeks.length - 1 - i) * 7, sets, target ? { target_reps: target } : {}));
}

describe("working sets", () => {
  test("warm-ups, timed sets, zero or fractional reps and absurd loads are not working sets", () => {
    expect(isWorkingSet({ weight_kg: 60, reps: 10, warmup: true })).toBe(false);
    expect(isWorkingSet({ weight_kg: 0, reps: 0 })).toBe(false); // a timed set is logged with reps 0
    expect(isWorkingSet({ weight_kg: 60, reps: 2.5 })).toBe(false);
    expect(isWorkingSet({ weight_kg: -20, reps: 5 })).toBe(false);
    expect(isWorkingSet({ weight_kg: 5000, reps: 5 })).toBe(false);
    expect(isWorkingSet({ weight_kg: Number.NaN, reps: 5 })).toBe(false);
    expect(isWorkingSet({ weight_kg: 0, reps: 12 })).toBe(true); // bodyweight
    expect(isWorkingSet({ weight_kg: 100, reps: 5 })).toBe(true);
  });

  test("a session's figures come from working sets only — the warm-up neither adds volume nor sets a best", () => {
    const p = sessionPerformance({
      session_id: "x", day: TODAY,
      sets: [
        { weight_kg: 140, reps: 3, warmup: true }, // a mislabelled heavy warm-up must not become the best
        { weight_kg: 100, reps: 5 },
        { weight_kg: 100, reps: 4 },
      ],
    });
    expect(p.working_sets).toBe(2);
    expect(p.warmup_sets).toBe(1);
    expect(p.volume_kg).toBe(900);
    expect(p.top_weight_kg).toBe(100);
    expect(p.reps_at_top_weight).toBe(5);
    expect(p.best_1rm).toBeCloseTo(estimated1RMExact(100, 5));
  });
});

describe("the 1RM and records the app already uses", () => {
  test("performance is relevantOneRm: Epley, unrounded, nothing past 12 reps", () => {
    const p = sessionPerformance(s("a", 0, [[100, 10]]));
    expect(p.best_1rm).toBe(relevantOneRm(100, 10));
    expect(p.best_1rm).toBeCloseTo(133.333, 2);
    expect(sessionPerformance(s("b", 0, [[50, ONE_RM_MAX_REPS + 3]])).best_1rm).toBeNull();
  });

  test("the PR judge is untouched: it still compares the rounded estimate", () => {
    expect(isPersonalRecord({ weight: 100, reps: 5 }, 116.6)).toBe(true);
    expect(isPersonalRecord({ weight: 100, reps: 5 }, 116.7)).toBe(false);
  });
});

describe("progress", () => {
  test("by load: 80 → 85 → 90 kg for 5 is progress, with the gain and the sessions behind it", () => {
    const a = analyzeProgression(weekly([[[80, 5]], [[80, 5]], [[82.5, 5]], [[85, 5]], [[87.5, 5]], [[90, 5]]]), TODAY);
    expect(a.status).toBe("progress");
    expect(a.metric).toBe("one_rm");
    expect(a.reasons[0]).toMatchObject({ code: "new_best", sessions_ago: 0 });
    expect(a.sessions_analyzed).toBe(6);
    expect(a.from_day).toBe(day(35));
    expect(a.to_day).toBe(TODAY);
    expect(a.latest?.top_weight_kg).toBe(90);
    expect(a.best?.top_weight_kg).toBe(90);
  });

  test("by reps at the same load: 100 × 5 → 6 → 7 → 8 is progress", () => {
    const a = analyzeProgression(weekly([[[100, 5]], [[100, 6]], [[100, 7]], [[100, 8]]]), TODAY);
    expect(a.status).toBe("progress");
    expect(a.comparison?.top_set?.kind).toBe("reps_up");
  });

  test("volume is weight × reps over working sets, and the comparison reports its change", () => {
    const a = analyzeProgression(weekly([[[60, 10]], [[60, 10]], [[60, 10]], [[60, 10], [60, 10]]]), TODAY);
    expect(a.latest?.volume_kg).toBe(1200);
    expect(a.comparison?.volume_delta_kg).toBe(600);
    expect(a.comparison?.sets_delta).toBe(1);
  });

  test("a bodyweight exercise is judged on reps", () => {
    const a = analyzeProgression(weekly([[[0, 8]], [[0, 9]], [[0, 10]], [[0, 12]]]), TODAY);
    expect(a.metric).toBe("reps");
    expect(a.status).toBe("progress");
  });

  test("loaded sets done only past 12 reps fall back to the best single set (weight × reps)", () => {
    const a = analyzeProgression(weekly([[[20, 15]], [[20, 16]], [[22, 15]], [[24, 15]]]), TODAY);
    expect(a.metric).toBe("best_set");
    expect(a.status).toBe("progress");
  });

  test("a slow creep counts once it adds up past the noise band", () => {
    // +1 % a week never beats the previous session by 2.5 %, but beats the last best after three weeks
    const a = analyzeProgression(weekly([[[100, 5]], [[101, 5]], [[102, 5]], [[103, 5]], [[104, 5]]]), TODAY);
    expect(a.status).toBe("progress");
  });
});

describe("possible plateau and stable", () => {
  test("eight weekly sessions without beating the best by more than the noise band: possible plateau", () => {
    const a = analyzeProgression(
      weekly([[[100, 5]], [[102.5, 5]], [[100, 5]], [[101, 5]], [[102.5, 5]], [[100, 5]], [[101, 5]], [[102.5, 5]]]),
      TODAY,
    );
    expect(a.status).toBe("plateau");
    expect(a.reasons[0]).toMatchObject({ code: "no_new_best" });
    const r = a.reasons[0] as { sessions: number; days: number };
    expect(r.sessions).toBeGreaterThanOrEqual(PROGRESSION_RULES.plateauSessions);
    expect(r.days).toBeGreaterThanOrEqual(PROGRESSION_RULES.plateauDays);
    expect(a.suggestion).toBe("check_consistency_recovery");
  });

  test("flat but not yet long enough: stable, not a plateau", () => {
    const a = analyzeProgression(weekly([[[100, 5]], [[100, 5]], [[101, 5]], [[100, 5]]]), TODAY);
    expect(a.status).toBe("stable");
    expect(a.reasons[0]).toMatchObject({ code: "within_band", band_pct: PROGRESSION_RULES.noisePct });
  });

  test("at the top of the prescribed range two sessions running: a small load increase is suggested, nothing is changed", () => {
    const sessions = weekly([[[60, 8], [60, 8]], [[60, 9], [60, 9]], [[60, 10], [60, 10]], [[60, 10], [60, 10], [60, 10]]], "8-10");
    const a = analyzeProgression(sessions, TODAY);
    expect(a.suggestion).toBe("consider_small_increase");
    // the input is untouched: the analysis returns a suggestion, not a new program
    expect(sessions[3]!.sets.every((x) => x.weight_kg === 60)).toBe(true);
  });

  test("the rep ceiling needs a prescription, the same load, and every working set at the top", () => {
    expect(repCeiling("8-10")).toBe(10);
    expect(repCeiling("8")).toBe(8);
    expect(repCeiling("AMRAP")).toBeNull();
    expect(repCeiling(null)).toBeNull();
    const perfOf = (ss: ProgressionSession[]) => ss.map(sessionPerformance);
    const noTarget = weekly([[[60, 10]], [[60, 10]]]);
    expect(atRepCeiling(perfOf(noTarget), noTarget, 2)).toBe(false);
    const oneShort = weekly([[[60, 10], [60, 10]], [[60, 10], [60, 9]]], "8-10");
    expect(atRepCeiling(perfOf(oneShort), oneShort, 2)).toBe(false);
    const loadChanged = weekly([[[60, 10]], [[62.5, 10]]], "8-10");
    expect(atRepCeiling(perfOf(loadChanged), loadChanged, 2)).toBe(false);
  });
});

describe("possible regression versus a fluctuation", () => {
  test("three of the last four sessions clearly under the earlier level: possible regression", () => {
    const a = analyzeProgression(
      weekly([[[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[90, 5]], [[90, 5]], [[100, 5]], [[90, 4]]]),
      TODAY,
    );
    expect(a.status).toBe("regression");
    expect(a.reasons[0]).toMatchObject({ code: "repeated_drop", drops: 3, of: 4 });
    expect(a.suggestion).toBe("check_volume_technique_recovery");
  });

  test("one bad session is a fluctuation, never a regression", () => {
    const a = analyzeProgression(
      weekly([[[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[80, 5]], [[100, 5]], [[100, 5]]]),
      TODAY,
    );
    expect(a.status).not.toBe("regression");
    expect(a.reasons.some((r) => r.code === "isolated_dip")).toBe(true);
  });

  test("two drops out of four are still not enough", () => {
    const a = analyzeProgression(
      weekly([[[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[90, 5]], [[100, 5]], [[90, 5]], [[100, 5]]]),
      TODAY,
    );
    expect(a.status).not.toBe("regression");
  });
});

describe("insufficient data", () => {
  test("a new exercise with no history: insufficient, nothing invented", () => {
    const a = analyzeProgression([], TODAY);
    expect(a).toMatchObject({ status: "insufficient", sessions_analyzed: 0, latest: null, best: null, comparison: null });
    expect(a.reasons[0]).toEqual({ code: "too_few_sessions", have: 0, need: PROGRESSION_RULES.minSessions });
    expect(a.suggestion).toBe("keep_logging");
  });

  test("three sessions are too few", () => {
    expect(analyzeProgression(weekly([[[80, 5]], [[85, 5]], [[90, 5]]]), TODAY).reasons[0]).toMatchObject({ code: "too_few_sessions", have: 3 });
  });

  test("four sessions in one week are too short a period", () => {
    const a = analyzeProgression([s("a", 6, [[80, 5]]), s("b", 4, [[82, 5]]), s("c", 2, [[84, 5]]), s("d", 0, [[86, 5]])], TODAY);
    expect(a.reasons[0]).toMatchObject({ code: "too_short_period" });
  });

  test("sessions a month apart are too infrequent to compare", () => {
    const a = analyzeProgression([s("a", 120, [[80, 5]]), s("b", 90, [[82, 5]]), s("c", 60, [[84, 5]]), s("d", 30, [[86, 5]])], TODAY);
    expect(a.reasons[0]).toMatchObject({ code: "too_infrequent" });
  });

  test("a good history that stopped two months ago says nothing about now", () => {
    const old = weekly([[[80, 5]], [[85, 5]], [[90, 5]], [[95, 5]]]).map((x) => ({ ...x, day: new Date(Date.parse(`${x.day}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10) }));
    expect(analyzeProgression(old, TODAY).reasons[0]).toMatchObject({ code: "no_recent_sessions" });
  });

  test("sessions with only warm-ups or invalid sets are not comparable sessions", () => {
    const sessions = [
      ...weekly([[[80, 5]], [[82.5, 5]], [[85, 5]]]),
      s("warm", 0, [[40, 10]], { warmup: true }),
      s("bad", 0, [[-5, 5], [60, 0]]),
    ];
    const a = analyzeProgression(sessions, TODAY);
    expect(a.sessions_analyzed).toBe(3);
    expect(a.status).toBe("insufficient");
    expect(a.warmups_excluded).toBe(1);
  });

  test("a future-dated session (clock skew) is not counted", () => {
    const a = analyzeProgression([...weekly([[[80, 5]], [[80, 5]], [[80, 5]]]), { session_id: "f", day: "2026-11-01", sets: [{ weight_kg: 200, reps: 5 }] }], TODAY);
    expect(a.sessions_analyzed).toBe(3);
  });
});

describe("rules are operational and overridable", () => {
  test("the defaults are the documented ones", () => {
    expect(PROGRESSION_RULES).toMatchObject({ minSessions: 4, minSpanDays: 21, noisePct: 2.5, plateauSessions: 4, plateauDays: 28, regressionPct: 5, regressionSessions: 3 });
  });

  test("a caller can tighten a rule and the verdict follows it", () => {
    const h = weekly([[[100, 5]], [[100, 5]], [[101, 5]], [[100, 5]]]);
    expect(analyzeProgression(h, TODAY).status).toBe("stable");
    expect(analyzeProgression(h, TODAY, { minSessions: 5 }).status).toBe("insufficient");
  });
});

describe("periods and series", () => {
  test("each period compares its first and last comparable session; under two sessions it says nothing", () => {
    const a = analyzeProgression(weekly([[[80, 5]], [[80, 5]], [[82.5, 5]], [[85, 5]], [[87.5, 5]], [[90, 5]]]), TODAY);
    const week = a.periods.find((p) => p.days === 7)!;
    expect(week.sessions).toBe(1);
    expect(week.change_pct).toBeNull();
    const month = a.periods.find((p) => p.days === 30)!;
    expect(month.sessions).toBe(5); // days 28, 21, 14, 7, 0
    expect(month.change_pct).toBeCloseTo(((90 - 80) / 80) * 100, 5);
    const all = a.periods.find((p) => p.days === null)!;
    expect(all.sessions).toBe(6);
    expect(a.series.map((x) => x.day)).toEqual([day(35), day(28), day(21), day(14), day(7), TODAY]);
  });
});

describe("units", () => {
  test("pounds typed by the person are stored as kg, so the verdict is the same in either unit", () => {
    const kg = weekly([[[100, 5]], [[100, 5]], [[102.5, 5]], [[105, 5]]]);
    const fromLb = kg.map((x) => ({ ...x, sets: x.sets.map((y) => ({ ...y, weight_kg: displayToKg(y.weight_kg * 2.2046226218, "lb") })) }));
    const a = analyzeProgression(kg, TODAY);
    const b = analyzeProgression(fromLb, TODAY);
    expect(b.status).toBe(a.status);
    expect(b.latest!.best_1rm!).toBeCloseTo(a.latest!.best_1rm!, 6);
  });
});

describe("edits and deletes re-derive the answer", () => {
  test("deleting the session that set the best changes the verdict on the next read", () => {
    const h = weekly([[[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]], [[110, 5]]]);
    expect(analyzeProgression(h, TODAY).status).toBe("progress");
    expect(analyzeProgression(h.slice(0, -1), TODAY).status).not.toBe("progress");
  });

  test("editing a set's weight is read straight away (nothing is stored)", () => {
    const h = weekly([[[100, 5]], [[100, 5]], [[100, 5]], [[100, 5]]]);
    const edited = h.map((x, i) => (i === 3 ? { ...x, sets: [{ weight_kg: 110, reps: 5 }] } : x));
    expect(analyzeProgression(h, TODAY).status).toBe("stable");
    expect(analyzeProgression(edited, TODAY).status).toBe("progress");
  });
});
