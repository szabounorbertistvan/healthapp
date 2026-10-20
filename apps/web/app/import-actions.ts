"use server";
// Importing workout history from Hevy or Strong (the page: (client)/workout/import).
//
// The browser parses the file (lib/import/workout-csv.ts), the person maps
// each exercise name to the library, and the sessions arrive here a few days
// at a time. Every write is the person's own rows under the same owner
// policies as logging a set (sessions_owner / sets_owner); nothing here is
// security definer.
//
// Re-importing never duplicates. A session's client_generated_id is derived
// from (user, wall-clock start, workout title) and each set's from (session,
// row position in the workout), and both are inserted with ignoreDuplicates —
// the same file twice is a no-op, and the same file with an exercise mapped
// that was skipped the first time adds just those sets.
//
// What imported sessions count toward (docs/GAPS.md, "Workout import"):
// - They are completed sessions, dated when they happened, with no program
//   day. So they are history everywhere history is read — PRs and e1RM,
//   exercise analytics, volume and load charts, the workout calendar and the
//   streak, badges — exactly as a session logged here on that day would be.
// - They never count toward program adherence: adherence measures following
//   a program day, and an imported session follows none.
// - A day that already has a workout logged in Voinic (or imported from
//   another file) is skipped whole, so the same workout logged in both apps
//   during a switch is not counted twice — in the streak, a challenge or a
//   leaderboard. A workout dated in the future is skipped too.
// - received_at, normally the server's arrival time, is set to when the set
//   was done: every PR judge and history list orders by it, and an import
//   stamped "now" would put years of sets after today's.
import { revalidatePath } from "next/cache";
import {
  DEFAULT_TIMEZONE, MAX_SET_REPS, validateSetEdit, zonedWallTimeToInstant,
} from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { liveUser } from "@/lib/supabase/server";
import { uuidFrom } from "@/lib/stable-id";
import { recomputeExercisePrs } from "@/lib/pr-history";
import { notSignedIn } from "@/lib/action-result";
import type { ActionResult } from "./actions";

export type ImportChunkSet = {
  ordinal: number;
  exerciseId: string;
  weightKg: number;
  reps: number;
  durationSeconds: number | null;
  rpe: number | null;
  notes: string | null;
};

export type ImportChunkSession = {
  title: string;
  startLocal: string;
  durationMinutes: number | null;
  notes: string | null;
  sets: ImportChunkSet[];
};

export type ImportChunkResult = ActionResult & {
  /** Sessions written now. */
  sessions?: number;
  /** Sets written now. */
  sets?: number;
  /** Sessions that were already on record from an earlier import of this file. */
  already?: number;
  /** Sessions left out because Voinic already has a workout that day. */
  dayTaken?: number;
  /** Sessions dated after now. */
  future?: number;
};

/** One call's ceiling — the page sends a few days at a time. */
const MAX_SESSIONS = 40;
const MAX_SETS_PER_SESSION = 400;
const WALL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The key an imported session is filed under — the same for every re-import of it. */
function importSessionKey(userId: string, startLocal: string, title: string): string {
  return uuidFrom(`import:${userId}:${startLocal}:${title}`);
}

export async function importWorkoutChunk(input: ImportChunkSession[]): Promise<ImportChunkResult> {
  const m = (await getI18n()).t.clientApp.workoutImport;
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SESSIONS) return { ok: false, message: m.errChunk };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  const { data: me } = await supabase.from("users").select("timezone").eq("id", userId).single();
  const timeZone = (me?.timezone as string | null) || DEFAULT_TIMEZONE;
  const now = Date.now();

  // ---- shape: what the browser sent, held to the logger's own rules ----
  type Planned = ImportChunkSession & { key: string; day: string; startedAt: Date; completedAt: Date };
  const planned: Planned[] = [];
  let future = 0;
  for (const s of input) {
    const wall = WALL_TIME.exec(String(s?.startLocal ?? ""));
    const title = String(s?.title ?? "").trim().slice(0, 200);
    if (!wall || !title || !Array.isArray(s.sets)) return { ok: false, message: m.errChunk };
    const startedAt = zonedWallTimeToInstant(wall[1]!, wall[2]!, timeZone);
    if (Number.isNaN(startedAt.getTime())) return { ok: false, message: m.errChunk };
    if (startedAt.getTime() > now) {
      future++;
      continue;
    }
    const minutes = Number.isFinite(s.durationMinutes) ? Math.min(Math.max(Math.round(s.durationMinutes!), 0), 600) : 0;
    const sets = s.sets
      .slice(0, MAX_SETS_PER_SESSION)
      .filter((x) =>
        Number.isInteger(x?.ordinal) && x.ordinal >= 0 && x.ordinal < 10_000 && UUID.test(String(x.exerciseId))
        && Number.isInteger(x.reps) && x.reps <= MAX_SET_REPS
        && !validateSetEdit({
          weight_kg: x.weightKg, reps: x.reps, rpe: x.rpe ?? null, rir: null, notes: null,
          duration_seconds: x.durationSeconds ?? null,
        }),
      );
    if (sets.length === 0) continue;
    planned.push({
      ...s, title, sets,
      notes: typeof s.notes === "string" ? s.notes.trim().slice(0, 500) || null : null,
      key: importSessionKey(userId, wall[0], title),
      day: wall[1]!,
      startedAt,
      completedAt: new Date(startedAt.getTime() + minutes * 60_000),
    });
  }
  if (planned.length === 0) return { ok: true, sessions: 0, sets: 0, already: 0, dayTaken: 0, future };

  // ---- exercises: only rows this person can see (RLS decides) ----
  const exerciseIds = [...new Set(planned.flatMap((s) => s.sets.map((x) => x.exerciseId)))];
  const { data: visible, error: exError } = await supabase.from("exercises").select("id").in("id", exerciseIds);
  if (exError) return { ok: false, message: m.errWrite };
  const known = new Set((visible ?? []).map((r) => r.id as string));

  // ---- days already trained in Voinic: left alone ----
  // The page sends a day's workouts together, so a session on the same day
  // that is not one of these keys was logged here, or imported from another
  // file — either way, that day is already counted.
  const keys = new Set(planned.map((s) => s.key));
  const times = planned.map((s) => s.startedAt.getTime());
  const DAY = 24 * 60 * 60 * 1000;
  const { data: existing, error: readError } = await supabase
    .from("logged_sessions")
    .select("client_generated_id, started_at")
    .eq("user_id", userId)
    .gte("started_at", new Date(Math.min(...times) - DAY).toISOString())
    .lte("started_at", new Date(Math.max(...times) + DAY).toISOString());
  if (readError) return { ok: false, message: m.errWrite };
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const takenDays = new Set(
    (existing ?? [])
      .filter((r) => !keys.has(r.client_generated_id as string))
      .map((r) => dayOf.format(new Date(r.started_at as string))),
  );
  const already = new Set((existing ?? []).map((r) => r.client_generated_id as string).filter((k) => keys.has(k)));
  const writable = planned
    .filter((s) => !takenDays.has(s.day))
    .map((s) => ({ ...s, sets: s.sets.filter((x) => known.has(x.exerciseId)) }))
    .filter((s) => s.sets.length > 0);
  const dayTaken = planned.filter((s) => takenDays.has(s.day)).length;
  if (writable.length === 0) return { ok: true, sessions: 0, sets: 0, already: already.size, dayTaken, future };

  // ---- sessions ----
  const { data: created, error: sessionError } = await supabase
    .from("logged_sessions")
    .upsert(
      writable.map((s) => ({
        user_id: userId,
        program_day_id: null,
        client_generated_id: s.key,
        started_at: s.startedAt.toISOString(),
        completed_at: s.completedAt.toISOString(),
        notes: [s.title, s.notes].filter(Boolean).join(" — ").slice(0, 500),
        received_at: s.startedAt.toISOString(),
      })),
      { onConflict: "client_generated_id", ignoreDuplicates: true },
    )
    .select("id");
  if (sessionError) {
    console.error("importWorkoutChunk sessions", sessionError);
    return { ok: false, message: m.errWrite };
  }
  const { data: rows, error: idError } = await supabase
    .from("logged_sessions")
    .select("id, client_generated_id")
    .eq("user_id", userId)
    .in("client_generated_id", writable.map((s) => s.key));
  if (idError) return { ok: false, message: m.errWrite };
  const idByKey = new Map((rows ?? []).map((r) => [r.client_generated_id as string, r.id as string]));

  // ---- sets ----
  const setRows = writable.flatMap((s) => {
    const sessionId = idByKey.get(s.key);
    if (!sessionId) return [];
    const perExercise = new Map<string, number>();
    return [...s.sets]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((x) => {
        const setIndex = (perExercise.get(x.exerciseId) ?? 0) + 1;
        perExercise.set(x.exerciseId, setIndex);
        // A second per row keeps the sets in the order they were done.
        const at = new Date(s.startedAt.getTime() + (x.ordinal + 1) * 1000).toISOString();
        return {
          session_id: sessionId,
          user_id: userId,
          exercise_id: x.exerciseId,
          program_exercise_id: null,
          set_index: setIndex,
          weight_kg: x.weightKg,
          reps: x.reps,
          duration_seconds: x.durationSeconds ?? null,
          rpe: x.rpe ?? null,
          notes: typeof x.notes === "string" ? x.notes.trim().slice(0, 500) || null : null,
          is_pr: false,
          client_generated_id: uuidFrom(`${s.key}:${x.ordinal}`),
          client_ts: at,
          received_at: at,
        };
      });
  });
  let setsWritten = 0;
  for (let i = 0; i < setRows.length; i += 500) {
    const { data, error } = await supabase
      .from("logged_sets")
      .upsert(setRows.slice(i, i + 500), { onConflict: "client_generated_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("importWorkoutChunk sets", error);
      return { ok: false, message: m.errWrite };
    }
    setsWritten += data?.length ?? 0;
  }

  return { ok: true, sessions: created?.length ?? 0, sets: setsWritten, already: already.size, dayTaken, future };
}

/**
 * After the last chunk: the PR flags of every lift the import touched,
 * re-derived over the whole history (imported and logged here) in the order
 * the sets were done. A few lifts per call, so no call runs long.
 */
export async function finishWorkoutImport(exerciseIds: string[]): Promise<ActionResult> {
  const m = (await getI18n()).t.clientApp.workoutImport;
  const ids = [...new Set(Array.isArray(exerciseIds) ? exerciseIds : [])].filter((id) => UUID.test(String(id)));
  if (ids.length > 25) return { ok: false, message: m.errChunk };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const results = await Promise.all(ids.map((id) => recomputeExercisePrs(supabase, userId, id)));
  if (results.some((r) => r === null)) return { ok: false, message: m.errWrite };
  revalidatePath("/today");
  revalidatePath("/workout", "layout");
  revalidatePath("/progress", "layout");
  revalidatePath("/exercises", "layout");
  return { ok: true };
}
