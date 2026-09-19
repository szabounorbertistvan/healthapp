import { describe, expect, test } from "vitest";
import { startRest } from "@healthapp/shared";
import { REST_TIMER_STORAGE_KEY, loadRestTimer, saveRestTimer } from "./storage";

const T0 = Date.parse("2026-09-19T10:30:00Z");

/** The subset of the Storage interface the helpers touch, in memory. */
function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

const timer = startRest({
  id: "abc123",
  durationSeconds: 90,
  now: T0,
  dayId: "day-1",
  exerciseName: "Bench Press",
  setIndex: 1,
  next: { programExerciseId: "pe-bench", exerciseName: "Bench Press", setIndex: 2 },
});

describe("rest timer persistence", () => {
  test("a saved timer comes back with its instants intact", () => {
    const store = memory();
    saveRestTimer(store, timer);
    expect(loadRestTimer(store)).toEqual(timer);
  });

  test("the timer is stored under one versioned key, as JSON", () => {
    const store = memory();
    saveRestTimer(store, timer);
    expect(Object.keys(store.dump())).toEqual([REST_TIMER_STORAGE_KEY]);
    expect(JSON.parse(store.dump()[REST_TIMER_STORAGE_KEY]).endsAt).toBe(T0 + 90_000);
  });

  test("saving null clears the entry", () => {
    const store = memory();
    saveRestTimer(store, timer);
    saveRestTimer(store, null);
    expect(loadRestTimer(store)).toBeNull();
  });

  test("garbage in storage is ignored, not thrown", () => {
    expect(loadRestTimer(memory({ [REST_TIMER_STORAGE_KEY]: "{not json" }))).toBeNull();
    expect(loadRestTimer(memory({ [REST_TIMER_STORAGE_KEY]: '{"id":"x"}' }))).toBeNull();
    expect(loadRestTimer(memory({ [REST_TIMER_STORAGE_KEY]: JSON.stringify({ ...timer, status: "weird" }) }))).toBeNull();
  });

  test("a storage that throws (private mode) behaves as empty", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(loadRestTimer(broken)).toBeNull();
    expect(() => saveRestTimer(broken, timer)).not.toThrow();
  });

  test("a stale timer that finished long ago is not restored", () => {
    const store = memory();
    saveRestTimer(store, timer);
    // Two hours later: the rest is history, not a completion to announce.
    expect(loadRestTimer(store, T0 + 2 * 60 * 60 * 1000)).toBeNull();
    // Ten seconds after the end: still worth surfacing as "rest finished".
    expect(loadRestTimer(store, T0 + 100_000)).toEqual(timer);
  });
});
