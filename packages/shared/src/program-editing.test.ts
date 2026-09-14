import { describe, expect, test } from "vitest";
import {
  DEFAULT_TARGETS,
  canEditProgram,
  circuitLabel,
  circuitSegments,
  nextCircuit,
  parseDecimal,
  recomputePrFlags,
  swapNeighbour,
  validateSetEdit,
  validateTargets,
} from "./program-editing";
import { estimated1RM } from "./prs";

describe("circuits", () => {
  const day = [
    { id: "bench", position: 0, circuit: 1 },
    { id: "row", position: 1, circuit: 1 },
    { id: "squat", position: 2, circuit: null },
    { id: "ohp", position: 3, circuit: 1 },
    { id: "curl", position: 4, circuit: 2 },
    { id: "ext", position: 5, circuit: 2 },
  ];
  test("labels count up from A", () => {
    expect(circuitLabel(1)).toBe("A");
    expect(circuitLabel(2)).toBe("B");
    expect(circuitLabel(26)).toBe("Z");
  });
  test("linked exercises are grouped under their circuit, in position order; standalone rows stay alone", () => {
    const segs = circuitSegments(day);
    expect(segs.map((s) => [s.label, s.exercises.map((e) => e.id)])).toEqual([
      ["A", ["bench", "row", "ohp"]],
      [null, ["squat"]],
      ["B", ["curl", "ext"]],
    ]);
  });
  test("creating a link picks the next free circuit; unlinking is circuit null", () => {
    expect(nextCircuit(day)).toBe(3);
    expect(nextCircuit([])).toBe(1);
    expect(circuitSegments(day.map((e) => ({ ...e, circuit: null }))).every((s) => s.label === null)).toBe(true);
  });
});

describe("reordering", () => {
  const rows = [
    { id: "a", position: 0 },
    { id: "b", position: 1 },
    { id: "c", position: 2 },
  ];
  test("moving a row down swaps it with the next one", () => {
    expect(swapNeighbour(rows, "a", 1)).toEqual([
      { id: "a", position: 1 },
      { id: "b", position: 0 },
    ]);
  });
  test("moving the last row up brings it to the front — Day 3 → Day 1 in two steps", () => {
    const step1 = swapNeighbour(rows, "c", -1);
    expect(step1).toEqual([{ id: "c", position: 1 }, { id: "b", position: 2 }]);
    const after1 = rows.map((r) => ({ ...r, position: step1.find((u) => u.id === r.id)?.position ?? r.position }));
    const step2 = swapNeighbour(after1, "c", -1);
    expect(step2).toEqual([{ id: "c", position: 0 }, { id: "a", position: 1 }]);
  });
  test("nothing moves past the edges", () => {
    expect(swapNeighbour(rows, "a", -1)).toEqual([]);
    expect(swapNeighbour(rows, "c", 1)).toEqual([]);
    expect(swapNeighbour(rows, "zzz", 1)).toEqual([]);
  });
});

describe("prescribed targets", () => {
  test("the defaults are a real prescription, not a placeholder", () => {
    expect(validateTargets(DEFAULT_TARGETS)).toBeNull();
    expect(DEFAULT_TARGETS).toMatchObject({ target_sets: 3, target_reps: "10", target_rpe: 2 });
  });
  test("4 × 8 RIR 1 and a rep range are valid", () => {
    expect(validateTargets({ ...DEFAULT_TARGETS, target_sets: 4, target_reps: "8", target_rpe: 1 })).toBeNull();
    expect(validateTargets({ ...DEFAULT_TARGETS, target_reps: "8-10" })).toBeNull();
  });
  test("the column bounds are checked before the round trip", () => {
    expect(validateTargets({ ...DEFAULT_TARGETS, target_sets: 0 })).toBe("sets");
    expect(validateTargets({ ...DEFAULT_TARGETS, target_sets: 21 })).toBe("sets");
    expect(validateTargets({ ...DEFAULT_TARGETS, target_reps: "lots" })).toBe("reps");
    expect(validateTargets({ ...DEFAULT_TARGETS, target_rpe: 11 })).toBe("rpe");
    expect(validateTargets({ ...DEFAULT_TARGETS, rest_seconds: 601 })).toBe("rest");
    expect(validateTargets({ ...DEFAULT_TARGETS, target_weight_kg: -5 })).toBe("weight");
  });
});

describe("decimals are kept as typed", () => {
  test("21.5 stays 21.5 and 21.25 stays 21.25", () => {
    expect(parseDecimal("21.5")).toBe(21.5);
    expect(parseDecimal("21.25")).toBe(21.25);
    expect(parseDecimal(21.25)).toBe(21.25);
  });
  test("a Romanian comma is a decimal point, not a truncation", () => {
    expect(parseDecimal("21,5")).toBe(21.5);
    expect(parseDecimal("21,25")).toBe(21.25);
  });
  test("blank or garbage is null, never 0 or NaN", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("  ")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("21.2.5")).toBeNull();
    expect(parseDecimal(null)).toBeNull();
  });
  test("no rounding anywhere on the way through", () => {
    expect(String(parseDecimal("80.125"))).toBe("80.125");
  });
});

describe("editing a logged set", () => {
  test("the same rules as logging", () => {
    expect(validateSetEdit({ weight_kg: 85, reps: 8, rpe: 8, rir: 1, notes: null })).toBeNull();
    expect(validateSetEdit({ weight_kg: -1, reps: 8, rpe: null, rir: null, notes: null })).toBe("weight");
    expect(validateSetEdit({ weight_kg: 80, reps: 0, rpe: null, rir: null, notes: null })).toBe("reps");
    expect(validateSetEdit({ weight_kg: 80, reps: 8, rpe: 11, rir: null, notes: null })).toBe("rpe");
    expect(validateSetEdit({ weight_kg: 80, reps: 8, rpe: null, rir: 11, notes: null })).toBe("rir");
  });
  test("an edit re-derives the PR flags: the corrected set becomes the record and the old record loses it", () => {
    const sets = [
      { id: "s1", weight_kg: 80, reps: 8, is_pr: true, received_at: "2026-09-01T10:00:00Z" },
      { id: "s2", weight_kg: 90, reps: 5, is_pr: true, received_at: "2026-09-08T10:00:00Z" }, // was the record…
      { id: "s3", weight_kg: 85, reps: 8, is_pr: false, received_at: "2026-09-08T10:05:00Z" },
    ];
    // s3 edited from 85×8 to 95×8 (e1RM above s2): s3 gains the flag; s2 keeps its own (still beat s1)
    const edited = sets.map((s) => (s.id === "s3" ? { ...s, weight_kg: 95 } : s));
    expect(recomputePrFlags(edited, estimated1RM)).toEqual([{ id: "s3", is_pr: true }]);
    // s2 edited down to 60×5: s2 loses the flag, s3 (85×8) now beats s1 and gains it
    const down = sets.map((s) => (s.id === "s2" ? { ...s, weight_kg: 60 } : s));
    expect(recomputePrFlags(down, estimated1RM)).toEqual([
      { id: "s2", is_pr: false },
      { id: "s3", is_pr: true },
    ]);
  });
  test("nothing changes when the edit does not touch the record", () => {
    const sets = [
      { id: "s1", weight_kg: 80, reps: 8, is_pr: true, received_at: "2026-09-01T10:00:00Z" },
      { id: "s2", weight_kg: 70, reps: 8, is_pr: false, received_at: "2026-09-02T10:00:00Z" },
    ];
    expect(recomputePrFlags(sets, estimated1RM)).toEqual([]);
  });
});

describe("who may edit a program", () => {
  const coachProgram = { coach_id: "coach", client_id: "client" };
  const ownProgram = { coach_id: null, client_id: "client" };
  test("a coach edits the programs they wrote", () => {
    expect(canEditProgram(coachProgram, { id: "coach", has_active_coach: false })).toBe(true);
  });
  test("a coached client edits nothing — not the coach's program, not their own", () => {
    expect(canEditProgram(coachProgram, { id: "client", has_active_coach: true })).toBe(false);
    expect(canEditProgram(ownProgram, { id: "client", has_active_coach: true })).toBe(false);
  });
  test("a solo client edits their own program", () => {
    expect(canEditProgram(ownProgram, { id: "client", has_active_coach: false })).toBe(true);
    expect(canEditProgram(ownProgram, { id: "someone", has_active_coach: false })).toBe(false);
  });
  test("connecting to a coach revokes the solo permission", () => {
    const before = canEditProgram(ownProgram, { id: "client", has_active_coach: false });
    const after = canEditProgram(ownProgram, { id: "client", has_active_coach: true });
    expect([before, after]).toEqual([true, false]);
  });
});
