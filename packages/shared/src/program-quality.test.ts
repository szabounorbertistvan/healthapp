import { describe, expect, it } from "vitest";
import { isPublishable, validateProgram, type ProgramShape, type ProgramShapeExercise } from "./program-quality";

function ex(over: Partial<ProgramShapeExercise> = {}): ProgramShapeExercise {
  return {
    id: over.id ?? "r1",
    exercise_id: "bench",
    exercise_known: true,
    position: 0,
    target_sets: 3,
    target_reps: "8-10",
    target_weight_kg: null,
    target_rpe: 2,
    rest_seconds: 90,
    circuit: null,
    set_type: "normal",
    ...over,
  };
}

function program(exercises: ProgramShapeExercise[], over: Partial<ProgramShape> = {}): ProgramShape {
  return { intensity_mode: "rir", days: [{ id: "d1", name: "Push", exercises }], ...over };
}

const codes = (p: ProgramShape) => {
  const r = validateProgram(p);
  return { errors: r.errors.map((i) => i.code), warnings: r.warnings.map((i) => i.code) };
};

describe("validateProgram — structure", () => {
  it("a complete program has no issues and is publishable", () => {
    const r = validateProgram(program([ex(), ex({ id: "r2", position: 1 })]));
    expect(r).toEqual({ errors: [], warnings: [] });
    expect(isPublishable(r)).toBe(true);
  });

  it("needs at least one day", () => {
    expect(codes({ intensity_mode: "rir", days: [] }).errors).toEqual(["no_days"]);
  });

  it("flags a day with no exercises, naming the day", () => {
    const r = validateProgram({ intensity_mode: "rir", days: [{ id: "d9", name: "Rest?", exercises: [] }] });
    expect(r.errors).toEqual([{ code: "empty_day", severity: "error", day_id: "d9" }]);
  });

  it("flags an exercise whose library row is gone or unreadable — an orphan prescription", () => {
    const r = validateProgram(program([ex({ exercise_known: false })]));
    expect(r.errors).toEqual([{ code: "unknown_exercise", severity: "error", day_id: "d1", exercise_row_id: "r1" }]);
  });

  it("flags two rows claiming the same position", () => {
    expect(codes(program([ex(), ex({ id: "r2", position: 0 })])).errors).toEqual(["duplicate_position"]);
  });
});

describe("validateProgram — prescriptions", () => {
  it.each([
    [{ target_sets: 0 }, "invalid_sets"],
    [{ target_sets: 21 }, "invalid_sets"],
    [{ target_sets: 2.5 }, "invalid_sets"],
    [{ target_reps: "ten" }, "invalid_reps"],
    [{ target_reps: "0" }, "invalid_reps"],
    [{ target_reps: "12-8" }, "reps_range_reversed"],
    [{ rest_seconds: -5 }, "invalid_rest"],
    [{ rest_seconds: 601 }, "invalid_rest"],
    [{ target_weight_kg: -1 }, "invalid_weight"],
    [{ set_type: "mystery" }, "invalid_set_type"],
  ])("%j → %s", (over, code) => {
    expect(codes(program([ex(over as Partial<ProgramShapeExercise>)])).errors).toContain(code);
  });

  it("accepts rep ranges, a single rep, no rest and no weight", () => {
    expect(codes(program([ex({ target_reps: "1", rest_seconds: null, target_weight_kg: null })])).errors).toEqual([]);
    expect(codes(program([ex({ target_reps: " 6 - 8 " })])).errors).toEqual([]);
  });

  it("RIR programs allow 0..10 — RIR 0 is a real prescription", () => {
    expect(codes(program([ex({ target_rpe: 0 })])).errors).toEqual([]);
    expect(codes(program([ex({ target_rpe: 10.5 })])).errors).toEqual(["rir_out_of_range"]);
  });

  it("RPE programs allow 1..10", () => {
    expect(codes(program([ex({ target_rpe: 0 })], { intensity_mode: "rpe" })).errors).toEqual(["rpe_out_of_range"]);
    expect(codes(program([ex({ target_rpe: 8.5 })], { intensity_mode: "rpe" })).errors).toEqual([]);
  });

  it("a 'simple' program carrying an intensity is only a warning — the number is ignored, not wrong", () => {
    const c = codes(program([ex({ target_rpe: 2 })], { intensity_mode: "simple" }));
    expect(c.errors).toEqual([]);
    expect(c.warnings).toEqual(["intensity_in_simple_mode"]);
  });

  it("does not let non-finite numbers through", () => {
    expect(codes(program([ex({ target_rpe: Number.NaN })])).errors).toEqual(["rir_out_of_range"]);
    expect(codes(program([ex({ rest_seconds: Number.POSITIVE_INFINITY })])).errors).toEqual(["invalid_rest"]);
  });
});

describe("validateProgram — supersets and circuits", () => {
  it("a circuit of consecutive exercises is fine", () => {
    const r = codes(program([ex({ circuit: 1 }), ex({ id: "r2", position: 1, circuit: 1 }), ex({ id: "r3", position: 2 })]));
    expect(r).toEqual({ errors: [], warnings: [] });
  });

  it("a circuit broken by another exercise in between is an error", () => {
    const r = codes(program([
      ex({ circuit: 1 }),
      ex({ id: "r2", position: 1 }),
      ex({ id: "r3", position: 2, circuit: 1 }),
    ]));
    expect(r.errors).toEqual(["circuit_not_contiguous"]);
  });

  it("order is by position, not by the order rows arrive in", () => {
    const r = codes(program([
      ex({ id: "r3", position: 2 }),
      ex({ id: "r2", position: 1, circuit: 1 }),
      ex({ id: "r1", position: 0, circuit: 1 }),
    ]));
    expect(r).toEqual({ errors: [], warnings: [] });
  });

  it("a circuit of one exercise is a warning — nothing is linked", () => {
    expect(codes(program([ex({ circuit: 2 }), ex({ id: "r2", position: 1 })])).warnings).toEqual(["circuit_single_exercise"]);
  });

  it("a circuit number outside A..Z is an error", () => {
    expect(codes(program([ex({ circuit: 0 }), ex({ id: "r2", position: 1, circuit: 0 })])).errors).toContain("invalid_circuit");
    expect(codes(program([ex({ circuit: 27 }), ex({ id: "r2", position: 1, circuit: 27 })])).errors).toContain("invalid_circuit");
  });

  it("the same circuit letter on two different days is two separate circuits", () => {
    const r = validateProgram({
      intensity_mode: "rir",
      days: [
        { id: "d1", name: "A", exercises: [ex({ circuit: 1 }), ex({ id: "r2", position: 1, circuit: 1 })] },
        { id: "d2", name: "B", exercises: [ex({ id: "r3", circuit: 1 }), ex({ id: "r4", position: 1, circuit: 1 })] },
      ],
    });
    expect(r).toEqual({ errors: [], warnings: [] });
  });
});

describe("isPublishable", () => {
  it("warnings do not block; errors do", () => {
    expect(isPublishable({ errors: [], warnings: [{ code: "circuit_single_exercise", severity: "warning" }] })).toBe(true);
    expect(isPublishable({ errors: [{ code: "no_days", severity: "error" }], warnings: [] })).toBe(false);
  });
});
