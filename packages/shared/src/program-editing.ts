// Editing a program and a logged workout — the rules the builders, the set
// logger and their server actions share. Pure, so they are tested here and
// applied identically in every surface:
//
//   · circuits: exercises of a day sharing `circuit` are linked (A, B, C…)
//     and keep their `position` order inside the group
//   · reordering: swapping two rows' positions / two days' indexes
//   · targets: what a prescribed exercise must carry (sets, reps, RIR/RPE, rest)
//   · decimals: "21,25" and "21.25" are both 21.25 — and stay 21.25
//   · PR flags: after a set is edited, which flags change

export const CIRCUIT_MAX = 26;

/** 1 → "A", 2 → "B" … the label a circuit number shows as. */
export function circuitLabel(circuit: number): string {
  return String.fromCharCode(64 + Math.min(CIRCUIT_MAX, Math.max(1, Math.round(circuit))));
}

export type CircuitSegment<T> = { circuit: number | null; label: string | null; exercises: T[] };

/**
 * A day's exercises as the UI shows them: standalone rows on their own,
 * linked rows grouped under their circuit — groups appear where their first
 * member sits, members keep their position order. Position order is the one
 * truth; a circuit is just a bracket around neighbours in it.
 */
export function circuitSegments<T extends { position: number; circuit: number | null }>(exercises: readonly T[]): CircuitSegment<T>[] {
  const sorted = [...exercises].sort((a, b) => a.position - b.position);
  const out: CircuitSegment<T>[] = [];
  const open = new Map<number, CircuitSegment<T>>();
  for (const e of sorted) {
    if (e.circuit === null) {
      out.push({ circuit: null, label: null, exercises: [e] });
      continue;
    }
    let seg = open.get(e.circuit);
    if (!seg) {
      seg = { circuit: e.circuit, label: circuitLabel(e.circuit), exercises: [] };
      open.set(e.circuit, seg);
      out.push(seg);
    }
    seg.exercises.push(e);
  }
  return out;
}

/** The next unused circuit number in a day, for "link as a new circuit". */
export function nextCircuit(exercises: readonly { circuit: number | null }[]): number {
  const used = new Set(exercises.map((e) => e.circuit).filter((c): c is number => c !== null));
  for (let c = 1; c <= CIRCUIT_MAX; c++) if (!used.has(c)) return c;
  return CIRCUIT_MAX;
}

// ---------- reordering ----------

/**
 * Move one row a step up (-1) or down (+1) among its siblings: the two rows
 * swap positions, nothing else moves. Returns the updates to write, or none
 * at the edge of the list. Works for exercises (position) and, with the same
 * shape, for anything else ordered by an integer.
 */
export function swapNeighbour<T extends { id: string; position: number }>(
  rows: readonly T[],
  id: string,
  direction: -1 | 1,
): { id: string; position: number }[] {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((r) => r.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return [];
  const me = sorted[i]!;
  const other = sorted[j]!;
  // rows that share a position (legacy inserts) still swap cleanly: use ordinals, not the stored numbers
  return [
    { id: me.id, position: j },
    { id: other.id, position: i },
  ];
}

// ---------- prescribed targets ----------

export type ExerciseTargets = {
  target_sets: number;
  /** "8" or a range "8-10". */
  target_reps: string;
  target_weight_kg: number | null;
  /** RIR in an RIR program, RPE otherwise — stored raw under the program's own scale. */
  target_rpe: number | null;
  rest_seconds: number | null;
};

export const DEFAULT_TARGETS: ExerciseTargets = { target_sets: 3, target_reps: "10", target_weight_kg: null, target_rpe: 2, rest_seconds: 90 };

export type TargetsError = "sets" | "reps" | "rpe" | "rest" | "weight";

/** The same bounds the columns enforce, checked before the round trip. */
export function validateTargets(t: ExerciseTargets): TargetsError | null {
  if (!Number.isInteger(t.target_sets) || t.target_sets < 1 || t.target_sets > 20) return "sets";
  if (!/^\d{1,3}(\s*-\s*\d{1,3})?$/.test(t.target_reps.trim())) return "reps";
  if (t.target_rpe !== null && (!Number.isFinite(t.target_rpe) || t.target_rpe < 0 || t.target_rpe > 10)) return "rpe";
  if (t.rest_seconds !== null && (!Number.isInteger(t.rest_seconds) || t.rest_seconds < 0 || t.rest_seconds > 600)) return "rest";
  if (t.target_weight_kg !== null && (!Number.isFinite(t.target_weight_kg) || t.target_weight_kg < 0)) return "weight";
  return null;
}

// ---------- decimals ----------

/**
 * A number as a person typed it: "21.25", "21,25", " 80 " — no rounding, no
 * truncation. Null when it is blank or not a number. The only place a body
 * weight, a bar weight or a circumference should ever be parsed.
 */
export function parseDecimal(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (input === null || input === undefined) return null;
  const text = input.trim().replace(",", ".");
  if (text === "" || !/^-?\d*(\.\d+)?$/.test(text) || text === "-" || text === ".") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// ---------- editing a logged set ----------

export type SetEdit = { weight_kg: number; reps: number; rpe: number | null; rir: number | null; notes: string | null };
export type SetEditError = "weight" | "reps" | "rpe" | "rir";

/** The same rules logSet() applies when a set is first logged. */
export function validateSetEdit(e: SetEdit): SetEditError | null {
  if (!Number.isFinite(e.weight_kg) || e.weight_kg < 0) return "weight";
  if (!Number.isInteger(e.reps) || e.reps <= 0 || e.reps > 200) return "reps";
  if (e.rpe !== null && (!Number.isFinite(e.rpe) || e.rpe < 1 || e.rpe > 10)) return "rpe";
  if (e.rir !== null && (!Number.isFinite(e.rir) || e.rir < 0 || e.rir > 10)) return "rir";
  return null;
}

/**
 * Re-derive is_pr over one exercise's sets in the order they were received:
 * a set is a PR when its estimated 1RM beats every set before it. Returns
 * only the rows whose flag changes, so an edit rewrites the flags it moved
 * and nothing else. `oneRm` is the app's estimator (estimated1RM).
 */
export function recomputePrFlags(
  sets: readonly { id: string; weight_kg: number; reps: number; is_pr: boolean; received_at: string }[],
  oneRm: (weight: number, reps: number) => number,
): { id: string; is_pr: boolean }[] {
  const ordered = [...sets].sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id));
  const changes: { id: string; is_pr: boolean }[] = [];
  let best = 0;
  for (const s of ordered) {
    const e = oneRm(s.weight_kg, s.reps);
    const pr = e > best;
    if (pr) best = e;
    if (pr !== s.is_pr) changes.push({ id: s.id, is_pr: pr });
  }
  return changes;
}

// ---------- who may edit a program ----------

/**
 * The permission rule the policies enforce (can_edit_program): a coach edits
 * the programs they wrote; a client edits the programs they own — while they
 * have no active coach. A coached client keeps reading their own programs.
 */
export function canEditProgram(
  program: { coach_id: string | null; client_id: string },
  viewer: { id: string; has_active_coach: boolean },
): boolean {
  if (program.coach_id !== null) return program.coach_id === viewer.id;
  return program.client_id === viewer.id && !viewer.has_active_coach;
}
