// The row shape PostgREST returns for an exercise-history read, and the
// mapping into the domain type.
//
// Split out of exercise-analytics-data.ts (which is "server-only" and cannot
// be imported by a test) because the one rule worth testing lives here: a set
// whose session was never completed must never reach analytics. The SQL is
// what enforces it; this is the second lock.
import type { AnalyticsSet } from "@healthapp/shared";

/** The columns analytics reads, plus the session the set belongs to. */
export const ANALYTICS_SET_SELECT = `id, set_index, weight_kg, reps, rpe, rir, is_pr, exercise_id, program_exercise_id,
  session:logged_sessions!inner(id, started_at, completed_at, day:program_days(name))`;

export type AnalyticsSetJoin = {
  id: string;
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  is_pr: boolean | null;
  exercise_id: string;
  program_exercise_id: string | null;
  session: {
    id: string;
    started_at: string;
    completed_at: string | null;
    day: { name: string } | null;
  } | null;
};

/**
 * Join rows to domain sets, dropping anything from a session that is still
 * open.
 *
 * The query already asks for `completed_at not is null` on the embedded
 * session, so in practice nothing is dropped here. It repeats the check
 * because a filter on an embedded resource is one URL parameter away from
 * silently not applying, and the failure mode is invisible: the logger would
 * offer numbers from a workout the person walked out of halfway through, and
 * the page would look completely normal.
 */
export function toAnalyticsSets(rows: readonly AnalyticsSetJoin[]): AnalyticsSet[] {
  const out: AnalyticsSet[] = [];
  for (const row of rows) {
    const session = row.session;
    if (!session || session.completed_at === null) continue;
    out.push({
      id: row.id,
      session_id: session.id,
      session_at: session.completed_at,
      session_name: session.day?.name ?? null,
      exercise_id: row.exercise_id,
      program_exercise_id: row.program_exercise_id,
      set_index: row.set_index,
      weight_kg: row.weight_kg ?? 0,
      reps: row.reps ?? 0,
      rpe: row.rpe,
      rir: row.rir,
      is_pr: Boolean(row.is_pr),
    });
  }
  return out;
}
