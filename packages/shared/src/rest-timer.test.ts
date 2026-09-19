import { describe, expect, test } from "vitest";
import {
  DEFAULT_REST_SECONDS,
  REST_EXTEND_SECONDS,
  REST_MAX_SECONDS,
  REST_MIN_SECONDS,
  REST_PRESETS,
  extendRest,
  formatRestClock,
  isRestActive,
  markRestNotified,
  nextPlannedSet,
  normalizeRestPrefs,
  pauseRest,
  plannedSets,
  remainingMs,
  resolveRestSeconds,
  restBetween,
  restAfterLoggedSet,
  resumeRest,
  settleRest,
  skipRest,
  startRest,
  type RestPrefs,
} from "./rest-timer";

// 2026-09-19 10:30:00 UTC — the clock the spec's worked example uses.
const T0 = Date.parse("2026-09-19T10:30:00Z");
const SEC = 1000;

const prefs: RestPrefs = { default_seconds: 60, notify: true, exercises: {} };

function start(over: Partial<Parameters<typeof startRest>[0]> = {}) {
  return startRest({
    id: "abc123",
    durationSeconds: 60,
    now: T0,
    dayId: "day-1",
    exerciseName: "Bench Press",
    setIndex: 2,
    next: { programExerciseId: "pe-bench", exerciseName: "Bench Press", setIndex: 3 },
    ...over,
  });
}

describe("rest duration settings", () => {
  test("the default is 60 seconds", () => {
    expect(DEFAULT_REST_SECONDS).toBe(60);
    expect(normalizeRestPrefs(undefined).default_seconds).toBe(60);
    expect(normalizeRestPrefs({}).default_seconds).toBe(60);
  });

  test("the presets are 30, 45, 60, 90, 120 and 180 seconds", () => {
    expect([...REST_PRESETS]).toEqual([30, 45, 60, 90, 120, 180]);
  });

  test.each([30, 45, 60, 90, 120, 180])("a %d second default is honoured", (seconds) => {
    const p = normalizeRestPrefs({ default_seconds: seconds });
    expect(resolveRestSeconds({ exerciseId: "ex-1", prescribedSeconds: null, prefs: p })).toBe(seconds);
  });

  test("a custom default is kept as typed, inside the allowed range", () => {
    expect(normalizeRestPrefs({ default_seconds: 75 }).default_seconds).toBe(75);
    expect(normalizeRestPrefs({ default_seconds: 2 }).default_seconds).toBe(REST_MIN_SECONDS);
    expect(normalizeRestPrefs({ default_seconds: 9999 }).default_seconds).toBe(REST_MAX_SECONDS);
    expect(normalizeRestPrefs({ default_seconds: "nope" }).default_seconds).toBe(60);
    expect(normalizeRestPrefs({ default_seconds: 61.7 }).default_seconds).toBe(62);
  });

  test("notify defaults to on and only a literal false turns it off", () => {
    expect(normalizeRestPrefs({}).notify).toBe(true);
    expect(normalizeRestPrefs({ notify: false }).notify).toBe(false);
    expect(normalizeRestPrefs({ notify: "no" }).notify).toBe(true);
  });

  test("exercise overrides are kept only when they are valid durations", () => {
    const p = normalizeRestPrefs({ exercises: { "ex-1": 120, "ex-2": "x", "ex-3": 0, "ex-4": 45.4 } });
    expect(p.exercises).toEqual({ "ex-1": 120, "ex-3": REST_MIN_SECONDS, "ex-4": 45 });
  });
});

describe("resolveRestSeconds", () => {
  test("an exercise-specific override wins over everything", () => {
    const p: RestPrefs = { ...prefs, exercises: { "ex-bench": 120 } };
    expect(resolveRestSeconds({ exerciseId: "ex-bench", prescribedSeconds: 90, prefs: p })).toBe(120);
  });

  test("the coach's prescribed rest is used when the user set no override", () => {
    expect(resolveRestSeconds({ exerciseId: "ex-bench", prescribedSeconds: 90, prefs })).toBe(90);
  });

  test("falls back to the global default when nothing is configured", () => {
    expect(resolveRestSeconds({ exerciseId: "ex-curl", prescribedSeconds: null, prefs })).toBe(60);
    expect(resolveRestSeconds({ exerciseId: null, prescribedSeconds: null, prefs })).toBe(60);
  });

  test("a prescribed rest of zero means 'no rest prescribed', not a zero-second timer", () => {
    expect(resolveRestSeconds({ exerciseId: "ex-1", prescribedSeconds: 0, prefs })).toBe(60);
  });

  test("an override keyed on a different exercise does not leak", () => {
    const p: RestPrefs = { ...prefs, exercises: { "ex-bench": 120 } };
    expect(resolveRestSeconds({ exerciseId: "ex-curl", prescribedSeconds: null, prefs: p })).toBe(60);
  });
});

describe("timestamp-based timer", () => {
  test("starting records exactly when the rest began and when it ends", () => {
    const t = start();
    expect(t.status).toBe("running");
    expect(t.startedAt).toBe(T0);
    expect(t.endsAt).toBe(T0 + 60 * SEC);
    expect(t.durationSeconds).toBe(60);
    expect(t.pausedRemainingMs).toBeNull();
    expect(t.notifiedAt).toBeNull();
    expect(t.context.next?.setIndex).toBe(3);
  });

  test("remaining time is endsAt minus now, not a tick count", () => {
    const t = start();
    // The spec's example: 60 s rest at 10:30:00, the user returns at 10:30:42.
    expect(remainingMs(t, T0 + 42 * SEC)).toBe(18 * SEC);
    expect(remainingMs(t, T0)).toBe(60 * SEC);
  });

  test("remaining never goes negative", () => {
    expect(remainingMs(start(), T0 + 300 * SEC)).toBe(0);
  });

  test("coming back after a background stretch settles a finished timer as completed", () => {
    const t = settleRest(start(), T0 + 61 * SEC);
    expect(t.status).toBe("completed");
    expect(remainingMs(t, T0 + 61 * SEC)).toBe(0);
  });

  test("settling before the end changes nothing", () => {
    const t = start();
    expect(settleRest(t, T0 + 30 * SEC)).toBe(t);
  });

  test("expires exactly at endsAt, not one tick later", () => {
    expect(settleRest(start(), T0 + 60 * SEC).status).toBe("completed");
    expect(settleRest(start(), T0 + 60 * SEC - 1).status).toBe("running");
  });

  test("the duration is independent of the clock's time zone offset", () => {
    // Same instant expressed from two zones: epoch milliseconds do not care.
    const bucharest = Date.parse("2026-09-19T13:30:00+03:00");
    const utc = Date.parse("2026-09-19T10:30:00Z");
    expect(bucharest).toBe(utc);
    const t = start({ now: bucharest });
    expect(t.endsAt - t.startedAt).toBe(60 * SEC);
    expect(remainingMs(t, utc + 42 * SEC)).toBe(18 * SEC);
  });

  test("a running or paused timer is active; anything else is not", () => {
    expect(isRestActive(start())).toBe(true);
    expect(isRestActive(pauseRest(start(), T0 + SEC))).toBe(true);
    expect(isRestActive(skipRest(start()))).toBe(false);
    expect(isRestActive(settleRest(start(), T0 + 61 * SEC))).toBe(false);
    expect(isRestActive(null)).toBe(false);
  });
});

describe("pause, resume, +15s, skip", () => {
  test("pausing freezes the remaining time", () => {
    const paused = pauseRest(start(), T0 + 20 * SEC);
    expect(paused.status).toBe("paused");
    expect(paused.pausedRemainingMs).toBe(40 * SEC);
    // However long it stays paused, it still reads 40 s.
    expect(remainingMs(paused, T0 + 500 * SEC)).toBe(40 * SEC);
  });

  test("resuming keeps the remaining time and recomputes endsAt from now", () => {
    const paused = pauseRest(start(), T0 + 20 * SEC);
    const resumed = resumeRest(paused, T0 + 100 * SEC);
    expect(resumed.status).toBe("running");
    expect(resumed.endsAt).toBe(T0 + 140 * SEC);
    expect(resumed.pausedRemainingMs).toBeNull();
    expect(remainingMs(resumed, T0 + 110 * SEC)).toBe(30 * SEC);
  });

  test("resuming keeps the original startedAt", () => {
    const resumed = resumeRest(pauseRest(start(), T0 + 20 * SEC), T0 + 100 * SEC);
    expect(resumed.startedAt).toBe(T0);
  });

  test("+15s pushes endsAt out by 15 seconds", () => {
    expect(REST_EXTEND_SECONDS).toBe(15);
    const t = extendRest(start(), T0 + 10 * SEC);
    expect(t.endsAt).toBe(T0 + 75 * SEC);
    expect(remainingMs(t, T0 + 10 * SEC)).toBe(65 * SEC);
  });

  test("+15s on a paused timer adds to the frozen remainder", () => {
    const t = extendRest(pauseRest(start(), T0 + 20 * SEC), T0 + 30 * SEC);
    expect(t.status).toBe("paused");
    expect(t.pausedRemainingMs).toBe(55 * SEC);
  });

  test("+15s on a completed timer revives it from now", () => {
    const done = settleRest(start(), T0 + 61 * SEC);
    const t = extendRest(done, T0 + 61 * SEC);
    expect(t.status).toBe("running");
    expect(t.endsAt).toBe(T0 + 76 * SEC);
  });

  test("skip ends the rest without a completion", () => {
    const t = skipRest(start());
    expect(t.status).toBe("skipped");
    expect(isRestActive(t)).toBe(false);
  });

  test("pausing or resuming a finished timer is a no-op", () => {
    const done = settleRest(start(), T0 + 61 * SEC);
    expect(pauseRest(done, T0 + 62 * SEC)).toBe(done);
    expect(resumeRest(done, T0 + 62 * SEC)).toBe(done);
  });
});

describe("completion is announced once", () => {
  test("the first notification on a completed timer is allowed and recorded", () => {
    const done = settleRest(start(), T0 + 61 * SEC);
    const { timer, shouldNotify } = markRestNotified(done, T0 + 61 * SEC);
    expect(shouldNotify).toBe(true);
    expect(timer.notifiedAt).toBe(T0 + 61 * SEC);
  });

  test("a second attempt on the same timer id is refused", () => {
    const done = settleRest(start(), T0 + 61 * SEC);
    const once = markRestNotified(done, T0 + 61 * SEC).timer;
    const again = markRestNotified(once, T0 + 90 * SEC);
    expect(again.shouldNotify).toBe(false);
    expect(again.timer).toBe(once);
  });

  test("a timer that is still running or was skipped never notifies", () => {
    expect(markRestNotified(start(), T0 + 10 * SEC).shouldNotify).toBe(false);
    expect(markRestNotified(skipRest(start()), T0 + 61 * SEC).shouldNotify).toBe(false);
  });

  test("extending a completed timer clears the notified flag so the new end announces once more", () => {
    const done = markRestNotified(settleRest(start(), T0 + 61 * SEC), T0 + 61 * SEC).timer;
    const revived = extendRest(done, T0 + 61 * SEC);
    expect(revived.notifiedAt).toBeNull();
  });
});

describe("formatRestClock", () => {
  test("shows mm:ss, rounding up so 0.4 s still reads as 1", () => {
    expect(formatRestClock(84 * SEC)).toBe("01:24");
    expect(formatRestClock(400)).toBe("00:01");
    expect(formatRestClock(0)).toBe("00:00");
    expect(formatRestClock(-5)).toBe("00:00");
    expect(formatRestClock(600 * SEC)).toBe("10:00");
  });
});

// ---------- which set is next ----------

type Ex = { id: string; exercise: string; exercise_id: string | null; sets: number; position: number; circuit: number | null };
const bench: Ex = { id: "pe-bench", exercise: "Bench Press", exercise_id: "ex-bench", sets: 3, position: 1, circuit: null };
const row: Ex = { id: "pe-row", exercise: "Row", exercise_id: "ex-row", sets: 2, position: 2, circuit: null };
const inclineA: Ex = { id: "pe-inc", exercise: "Incline DB Press", exercise_id: "ex-inc", sets: 2, position: 3, circuit: 1 };
const flyA: Ex = { id: "pe-fly", exercise: "Cable Fly", exercise_id: "ex-fly", sets: 2, position: 4, circuit: 1 };

describe("plannedSets", () => {
  test("standalone exercises are listed set by set in position order", () => {
    expect(plannedSets([row, bench]).map((s) => `${s.exerciseName}#${s.setIndex}`)).toEqual([
      "Bench Press#1", "Bench Press#2", "Bench Press#3", "Row#1", "Row#2",
    ]);
  });

  test("a circuit is one set of each member, then the next round", () => {
    expect(plannedSets([inclineA, flyA]).map((s) => `${s.exerciseName}#${s.setIndex}`)).toEqual([
      "Incline DB Press#1", "Cable Fly#1", "Incline DB Press#2", "Cable Fly#2",
    ]);
  });

  test("a circuit member with fewer sets drops out of later rounds", () => {
    const short = { ...flyA, sets: 1 };
    expect(plannedSets([inclineA, short]).map((s) => `${s.exerciseName}#${s.setIndex}`)).toEqual([
      "Incline DB Press#1", "Cable Fly#1", "Incline DB Press#2",
    ]);
  });
});

describe("nextPlannedSet", () => {
  test("after a set, the next set of the same exercise is next", () => {
    const next = nextPlannedSet([bench, row], { "pe-bench": 1 }, { programExerciseId: "pe-bench", setIndex: 1 });
    expect(next).toMatchObject({ programExerciseId: "pe-bench", setIndex: 2 });
  });

  test("after the last set of an exercise, the next exercise's first set is next", () => {
    const next = nextPlannedSet([bench, row], { "pe-bench": 3 }, { programExerciseId: "pe-bench", setIndex: 3 });
    expect(next).toMatchObject({ programExerciseId: "pe-row", setIndex: 1 });
  });

  test("the final set of the workout has no next set — no rest timer", () => {
    const next = nextPlannedSet([bench, row], { "pe-bench": 3, "pe-row": 2 }, { programExerciseId: "pe-row", setIndex: 2 });
    expect(next).toBeNull();
  });

  test("sets already logged are skipped over", () => {
    // Row was done first; finishing bench then has nothing left.
    const next = nextPlannedSet([bench, row], { "pe-bench": 3, "pe-row": 2 }, { programExerciseId: "pe-bench", setIndex: 3 });
    expect(next).toBeNull();
  });

  test("an unlogged set earlier in the plan is offered when nothing remains after the current one", () => {
    const next = nextPlannedSet([bench, row], { "pe-row": 2 }, { programExerciseId: "pe-row", setIndex: 2 });
    expect(next).toMatchObject({ programExerciseId: "pe-bench", setIndex: 1 });
  });

  test("an extra set beyond the target still finds what is left", () => {
    const next = nextPlannedSet([bench, row], { "pe-bench": 4 }, { programExerciseId: "pe-bench", setIndex: 4 });
    expect(next).toMatchObject({ programExerciseId: "pe-row", setIndex: 1 });
  });

  test("in a superset the next set belongs to the other exercise", () => {
    const next = nextPlannedSet([inclineA, flyA], { "pe-inc": 1 }, { programExerciseId: "pe-inc", setIndex: 1 });
    expect(next).toMatchObject({ programExerciseId: "pe-fly", setIndex: 1 });
  });

  test("after the last member of a round the next round starts with the first member", () => {
    const next = nextPlannedSet([inclineA, flyA], { "pe-inc": 1, "pe-fly": 1 }, { programExerciseId: "pe-fly", setIndex: 1 });
    expect(next).toMatchObject({ programExerciseId: "pe-inc", setIndex: 2 });
  });
});

describe("restBetween", () => {
  const plan = plannedSets([bench, inclineA, flyA]);
  const at = (ex: string, set: number) => plan.find((s) => s.programExerciseId === ex && s.setIndex === set)!;

  test("standalone sets rest between them", () => {
    expect(restBetween(at("pe-bench", 1), at("pe-bench", 2))).toBe(true);
    expect(restBetween(at("pe-bench", 3), at("pe-inc", 1))).toBe(true);
  });

  test("inside a superset round there is no rest — straight to the paired exercise", () => {
    expect(restBetween(at("pe-inc", 1), at("pe-fly", 1))).toBe(false);
  });

  test("the round's last member rests before the next round", () => {
    expect(restBetween(at("pe-fly", 1), at("pe-inc", 2))).toBe(true);
  });

  test("nothing after the final set", () => {
    expect(restBetween(at("pe-fly", 2), null)).toBe(false);
  });
});

describe("restAfterLoggedSet — the decision the set logger makes", () => {
  const day = { exercises: [bench, row], completed: false };
  const logged = (ex: string, set: number) => ({ programExerciseId: ex, exerciseId: ex.replace("pe-", "ex-"), setIndex: set, prescribedSeconds: 90 });

  test("a saved set that is not the last starts a rest with the resolved duration and the next set", () => {
    const plan = restAfterLoggedSet({ saved: true, day, loggedCount: { "pe-bench": 1 }, justLogged: logged("pe-bench", 1), prefs });
    expect(plan).toEqual({
      durationSeconds: 90,
      next: { programExerciseId: "pe-bench", exerciseName: "Bench Press", setIndex: 2 },
    });
  });

  test("a set that failed to save starts no timer", () => {
    expect(restAfterLoggedSet({ saved: false, day, loggedCount: { "pe-bench": 1 }, justLogged: logged("pe-bench", 1), prefs })).toBeNull();
  });

  test("a rest typed for this one set beats the exercise override, the prescription and the default", () => {
    const p: RestPrefs = { ...prefs, exercises: { "ex-bench": 120 } };
    const plan = restAfterLoggedSet({
      saved: true, day, loggedCount: { "pe-bench": 1 },
      justLogged: { ...logged("pe-bench", 1), restSecondsForThisSet: 45 }, prefs: p,
    });
    expect(plan).toMatchObject({ durationSeconds: 45 });
  });

  test("a per-set rest is clamped to the allowed range and ignored when empty", () => {
    const at = (value: number | null) =>
      restAfterLoggedSet({ saved: true, day, loggedCount: { "pe-bench": 1 }, justLogged: { ...logged("pe-bench", 1), restSecondsForThisSet: value }, prefs })
        ?.durationSeconds;
    expect(at(1)).toBe(REST_MIN_SECONDS);
    expect(at(5000)).toBe(REST_MAX_SECONDS);
    expect(at(null)).toBe(90);
    expect(at(Number.NaN)).toBe(90);
  });

  test("the final set of the workout starts no timer", () => {
    expect(restAfterLoggedSet({ saved: true, day, loggedCount: { "pe-bench": 3, "pe-row": 2 }, justLogged: logged("pe-row", 2), prefs })).toBeNull();
  });

  test("an already completed workout starts no timer", () => {
    expect(restAfterLoggedSet({ saved: true, day: { ...day, completed: true }, loggedCount: { "pe-bench": 1 }, justLogged: logged("pe-bench", 1), prefs })).toBeNull();
  });

  test("inside a superset round no timer starts; after the round it does", () => {
    const circuitDay = { exercises: [inclineA, flyA], completed: false };
    expect(restAfterLoggedSet({ saved: true, day: circuitDay, loggedCount: { "pe-inc": 1 }, justLogged: logged("pe-inc", 1), prefs })).toBeNull();
    expect(restAfterLoggedSet({ saved: true, day: circuitDay, loggedCount: { "pe-inc": 1, "pe-fly": 1 }, justLogged: logged("pe-fly", 1), prefs }))
      .toMatchObject({ next: { programExerciseId: "pe-inc", setIndex: 2 } });
  });

  test("the user's exercise override beats the prescribed rest", () => {
    const p: RestPrefs = { ...prefs, exercises: { "ex-bench": 120 } };
    expect(restAfterLoggedSet({ saved: true, day, loggedCount: { "pe-bench": 1 }, justLogged: logged("pe-bench", 1), prefs: p }))
      .toMatchObject({ durationSeconds: 120 });
  });
});
