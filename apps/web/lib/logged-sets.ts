import type { LoggedSetRow } from "./types";

/** The columns a logged set is read with, live. */
export const LOGGED_SET_SELECT =
  "id, program_exercise_id, exercise_id, set_index, weight_kg, reps, rpe, rir, notes, is_pr, received_at, exercise:exercises(name_en, name_ro)";

export type SetJoin = {
  id: string; program_exercise_id: string | null; exercise_id?: string | null; set_index: number;
  weight_kg: number | null; reps: number | null; rpe: number | null; rir: number | null;
  notes: string | null; is_pr: boolean | null; received_at: string;
  exercise: { name_en: string; name_ro: string | null } | null;
};

export function toLoggedSetRow(s: SetJoin): LoggedSetRow {
  return {
    id: s.id,
    program_exercise_id: s.program_exercise_id,
    exercise_id: s.exercise_id ?? null,
    exercise: s.exercise?.name_ro ?? s.exercise?.name_en ?? "—",
    set_index: s.set_index,
    weight_kg: s.weight_kg ?? 0,
    reps: s.reps ?? 0,
    rpe: s.rpe,
    rir: s.rir,
    notes: s.notes,
    is_pr: Boolean(s.is_pr),
    at: s.received_at,
  };
}
