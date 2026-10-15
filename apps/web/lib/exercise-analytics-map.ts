// The row shape PostgREST returns for an exercise-history read, and the
// mapping into the domain type.
//
// Split out of exercise-analytics-data.ts (which is "server-only" and cannot
// be imported by a test) because the one rule worth testing lives here: a set
// whose session was never completed must never reach analytics. The SQL is
// what enforces it; this is the second lock.
import { localDay, type AnalyticsSet, type ProgressionSession } from "@healthapp/shared";

/**
 * The columns analytics reads, plus the session the set belongs to and the
 * prescription it was logged against — `set_type` is how a warm-up is told
 * from a working set (program_exercises, 20260930100000), `target_reps` the
 * range the progression suggestion reads. The prescription is read under the
 * reader's own policies; a row they cannot see (or a deleted one) comes back
 * null and the set counts as a working set.
 */
export const ANALYTICS_SET_SELECT = `id, set_index, weight_kg, reps, duration_seconds, rpe, rir, is_pr, exercise_id, program_exercise_id,
  session:logged_sessions!inner(id, started_at, completed_at, day:program_days(name)),
  prescribed:program_exercises(set_type, target_reps)`;

export type AnalyticsSetJoin = {
  id: string;
  set_index: number;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds?: number | null;
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
  prescribed?: { set_type: string | null; target_reps: string | null } | null;
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
      ...(row.duration_seconds ? { duration_seconds: row.duration_seconds } : {}),
      rpe: row.rpe,
      rir: row.rir,
      is_pr: Boolean(row.is_pr),
      // Carried only when a prescription came back, so a set without one keeps its old shape.
      ...(row.prescribed
        ? { warmup: row.prescribed.set_type === "warmup", target_reps: row.prescribed.target_reps }
        : {}),
    });
  }
  return out;
}

/**
 * One exercise's sets → the sessions the progression analysis compares, each
 * on the person's own calendar day (the day the session was completed there).
 * Timed sets keep reps 0 and fall out as non-working in the analysis itself.
 */
export function toProgressionSessions(sets: readonly AnalyticsSet[], timeZone: string): ProgressionSession[] {
  const bySession = new Map<string, ProgressionSession & { sets: ProgressionSession["sets"][number][] }>();
  for (const x of sets) {
    let s = bySession.get(x.session_id);
    if (!s) {
      s = { session_id: x.session_id, day: localDay(x.session_at, timeZone), sets: [] };
      bySession.set(x.session_id, s);
    }
    s.sets.push({ weight_kg: x.weight_kg, reps: x.reps, warmup: x.warmup === true, target_reps: x.target_reps ?? null });
  }
  return [...bySession.values()];
}
