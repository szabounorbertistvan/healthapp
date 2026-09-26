// Program completeness — a deterministic check of a whole program's structure
// and prescriptions, returning every issue it finds, each with where it is.
//
// It is ADVISORY by design. Programs written before this existed may break a
// rule (an empty day, a one-exercise "superset"), and nothing here makes them
// unreadable, untrainable or uneditable. It is enforced at exactly one new
// door: making a routine PUBLIC (routine-actions updateRoutineDetails), so the
// shelf only gains complete programs from now on. What is already public stays.
//
// The bounds are the same ones the columns and validateTargets() hold:
//   sets 1..20 whole · reps "N" or "N-M", 1..999 · rest 0..600 s whole ·
//   weight ≥ 0 · circuit 1..26 (A..Z) · intensity by the program's own scale:
//   RIR 0..10, RPE 1..10, and in a "simple" program a stored number is ignored.
import { CIRCUIT_MAX } from "./program-editing";

export const SET_TYPES = ["normal", "warmup", "drop_set", "amrap", "to_failure"] as const;
export type SetType = (typeof SET_TYPES)[number];

export function isSetType(x: unknown): x is SetType {
  return typeof x === "string" && (SET_TYPES as readonly string[]).includes(x);
}

export type ProgramShapeExercise = {
  /** program_exercises.id */
  id: string;
  exercise_id: string | null;
  /** False when the library row is gone or unreadable to the checker. */
  exercise_known: boolean;
  position: number;
  target_sets: number;
  target_reps: string;
  target_weight_kg: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
  circuit: number | null;
  /** Absent on rows read before the column existed; treated as "normal". */
  set_type?: string | null;
};

export type ProgramShape = {
  intensity_mode: "rpe" | "rir" | "simple";
  days: { id: string; name: string; exercises: ProgramShapeExercise[] }[];
};

export type ProgramIssueCode =
  | "no_days"
  | "empty_day"
  | "unknown_exercise"
  | "duplicate_position"
  | "invalid_sets"
  | "invalid_reps"
  | "reps_range_reversed"
  | "rir_out_of_range"
  | "rpe_out_of_range"
  | "intensity_in_simple_mode"
  | "invalid_rest"
  | "invalid_weight"
  | "invalid_set_type"
  | "invalid_circuit"
  | "circuit_not_contiguous"
  | "circuit_single_exercise";

export type ProgramIssue = {
  code: ProgramIssueCode;
  severity: "error" | "warning";
  day_id?: string;
  exercise_row_id?: string;
};

export type ProgramValidation = { errors: ProgramIssue[]; warnings: ProgramIssue[] };

const REPS = /^(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function validateProgram(program: ProgramShape): ProgramValidation {
  const errors: ProgramIssue[] = [];
  const warnings: ProgramIssue[] = [];
  const error = (code: ProgramIssueCode, where: Omit<ProgramIssue, "code" | "severity"> = {}) =>
    errors.push({ code, severity: "error", ...where });
  const warn = (code: ProgramIssueCode, where: Omit<ProgramIssue, "code" | "severity"> = {}) =>
    warnings.push({ code, severity: "warning", ...where });

  if (program.days.length === 0) {
    error("no_days");
    return { errors, warnings };
  }

  for (const day of program.days) {
    const at = { day_id: day.id };
    if (day.exercises.length === 0) {
      error("empty_day", at);
      continue;
    }
    const rows = [...day.exercises].sort((a, b) => a.position - b.position);

    const positions = new Set<number>();
    let duplicate = false;
    for (const r of rows) {
      if (positions.has(r.position)) duplicate = true;
      positions.add(r.position);
    }
    if (duplicate) error("duplicate_position", at);

    for (const r of rows) {
      const where = { day_id: day.id, exercise_row_id: r.id };
      if (!r.exercise_id || !r.exercise_known) error("unknown_exercise", where);

      if (!Number.isInteger(r.target_sets) || r.target_sets < 1 || r.target_sets > 20) error("invalid_sets", where);

      const reps = REPS.exec((r.target_reps ?? "").trim());
      if (!reps || Number(reps[1]) < 1 || (reps[2] !== undefined && Number(reps[2]) < 1)) {
        error("invalid_reps", where);
      } else if (reps[2] !== undefined && Number(reps[2]) < Number(reps[1])) {
        error("reps_range_reversed", where);
      }

      if (r.target_rpe !== null && r.target_rpe !== undefined) {
        if (program.intensity_mode === "simple") warn("intensity_in_simple_mode", where);
        else if (program.intensity_mode === "rir") {
          if (!finite(r.target_rpe) || r.target_rpe < 0 || r.target_rpe > 10) error("rir_out_of_range", where);
        } else if (!finite(r.target_rpe) || r.target_rpe < 1 || r.target_rpe > 10) {
          error("rpe_out_of_range", where);
        }
      }

      if (r.rest_seconds !== null && r.rest_seconds !== undefined) {
        if (!Number.isInteger(r.rest_seconds) || r.rest_seconds < 0 || r.rest_seconds > 600) error("invalid_rest", where);
      }
      if (r.target_weight_kg !== null && r.target_weight_kg !== undefined) {
        if (!finite(r.target_weight_kg) || r.target_weight_kg < 0) error("invalid_weight", where);
      }
      if (r.set_type !== null && r.set_type !== undefined && !isSetType(r.set_type)) error("invalid_set_type", where);
    }

    // Circuits: members must sit next to each other in position order — a
    // superset split by an unrelated exercise is not a superset.
    const members = new Map<number, number[]>();
    rows.forEach((r, index) => {
      if (r.circuit === null || r.circuit === undefined) return;
      const list = members.get(r.circuit) ?? [];
      list.push(index);
      members.set(r.circuit, list);
    });
    for (const [circuit, indexes] of members) {
      const firstRow = rows[indexes[0]!]!;
      const where = { day_id: day.id, exercise_row_id: firstRow.id };
      if (!Number.isInteger(circuit) || circuit < 1 || circuit > CIRCUIT_MAX) {
        error("invalid_circuit", where);
        continue;
      }
      if (indexes.length === 1) warn("circuit_single_exercise", where);
      else if (indexes[indexes.length - 1]! - indexes[0]! !== indexes.length - 1) error("circuit_not_contiguous", where);
    }
  }
  return { errors, warnings };
}

/** Warnings describe; errors block the one door this guards (going public). */
export function isPublishable(result: ProgramValidation): boolean {
  return result.errors.length === 0;
}
