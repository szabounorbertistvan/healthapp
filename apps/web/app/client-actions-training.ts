"use server";
// Logging a set. The session and set ids are derived, never random, so a
// retry from a dropped connection cannot create a second row.
import { revalidatePath } from "next/cache";
import { isoDay } from "@/lib/dates";
import {
  estimated1RM, isPersonalRecord, MAX_SET_REPS, MAX_SET_SECONDS, MAX_SET_WEIGHT_KG,
  recomputePrFlags, validateSetEdit, type SetEdit, type SetEditError,
} from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { liveUser, type LiveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { sessionKeyFor, uuidFrom } from "@/lib/stable-id";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";



export type LogSetResult = ActionResult & { is_pr?: boolean; estimated_1rm?: number };



/**
 * Log one set. PR detection runs here against the best estimated 1RM so far —
 * the same isPersonalRecord() the mobile app calls the instant a set is
 * confirmed, so the two verdicts cannot disagree.
 */
export type LogSetInput = {
  dayId: string;
  dayName: string;
  exerciseName: string;
  /** exercises.id — required, since logged_sets.exercise_id is NOT NULL. */
  exerciseId?: string | null;
  /** program_exercises.id, so a set can be traced back to what was prescribed. */
  programExerciseId?: string | null;
  setIndex: number;
  weightKg: number;
  reps: number;
  /** Felt intensity 1..10 from the slider. */
  rpe: number | null;
  /** Reps in reserve as typed (RIR-mode programs), 0..10. */
  rir?: number | null;
  /** Free-text comment about the set. */
  notes?: string | null;
  /** Seconds, for a timed exercise (measure = time) — reps is 0 then. */
  durationSeconds?: number | null;
  /**
   * When the set was done, ISO. Only the offline outbox (lib/offline) sends
   * it: a set queued at 23:50 and synced after midnight still belongs to that
   * evening's session. Absent, implausible or too old, it is "now".
   */
  loggedAt?: string;
};



/** A replayed set's own time, within reason; otherwise now. */
function loggedAtOrNow(loggedAt: string | undefined): Date {
  const now = Date.now();
  const at = loggedAt ? Date.parse(loggedAt) : NaN;
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  return Number.isFinite(at) && at <= now + 5 * 60 * 1000 && at >= now - WEEK ? new Date(at) : new Date(now);
}



export async function logSet(input: LogSetInput): Promise<LogSetResult> {
  const rir = input.rir ?? null;
  const notes = input.notes?.trim().slice(0, 500) || null;
  // The same rules — and the same plausibility caps — an edit is held to, in
  // words the person can act on rather than the constraint name Postgres
  // would otherwise hand back.
  const durationSeconds = input.durationSeconds ?? null;
  const invalid = validateSetEdit({ weight_kg: input.weightKg, reps: input.reps, rpe: input.rpe, rir, notes, duration_seconds: durationSeconds });
  if (invalid) return { ok: false, message: await setErrorMessage(invalid) };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  if (!input.exerciseId) {
    // logged_sets.exercise_id is NOT NULL and there is no name lookup here on
    // purpose: guessing an exercise by name would silently log against the
    // wrong row. The program screens carry the id through instead.
    return { ok: false, message: (await getI18n()).t.clientWidgets.setLogger.errMissingExercise };
  }

  // client_generated_id is a uuid column, and it is what makes a retry safe.
  // Deriving it from the day and date keeps one session per day per program
  // day however many times this runs.
  const at = loggedAtOrNow(input.loggedAt);
  const sessionKey = sessionKeyFor(userId, input.dayId, isoDay(at));
  const session = await openSession(supabase, userId, input.dayId, sessionKey, at.toISOString());
  if ("ok" in session) return session;
  const sessionId = session.id;

  // The same PR check the mobile app runs, against the best estimated 1RM
  // already on record for this lift — over the whole history, exactly what
  // updateLoggedSet's recomputePrFlags() walks. A 200-set window here once
  // announced records the edit path then took back.
  const history = await setsOfExercise(supabase, userId, input.exerciseId);
  const best = history.reduce(
    (max, s) => Math.max(max, estimated1RM(Number(s.weight_kg ?? 0), s.reps ?? 0)),
    0,
  );
  const isPr = isPersonalRecord(
    { weight: input.weightKg, reps: input.reps },
    best > 0 ? best : null,
  );

  // Keyed on the prescribed row, not the library exercise: a day may program
  // the same lift twice (heavy, then a back-off block) and each keeps its own
  // set numbering.
  const setKey = uuidFrom(`${sessionId}:${input.programExerciseId ?? input.exerciseId}:${input.setIndex}`);
  const { error } = await supabase.from("logged_sets").insert({
    session_id: sessionId,
    user_id: userId,
    exercise_id: input.exerciseId,
    program_exercise_id: input.programExerciseId ?? null,
    set_index: input.setIndex,
    weight_kg: input.weightKg,
    reps: input.reps,
    duration_seconds: durationSeconds,
    rpe: input.rpe,
    rir,
    notes,
    is_pr: isPr,
    client_generated_id: setKey,
    client_ts: at.toISOString(),
  });
  if (error?.code === "23505") {
    // This set is already on record. Usually a replay: the outbox sent it, the
    // answer was lost with the signal, and it is sending it again — which is
    // success, not an error, or the set would retry for ever. A different set
    // under the same number (one deleted in between, say) is still refused.
    const { data: existing } = await supabase
      .from("logged_sets")
      .select("weight_kg, reps, duration_seconds, is_pr")
      .eq("client_generated_id", setKey)
      .maybeSingle();
    // weight_kg is numeric(6,2): a pound-converted weight comes back rounded.
    if (
      existing && Math.abs(Number(existing.weight_kg) - input.weightKg) < 0.006 && existing.reps === input.reps
      && (existing.duration_seconds ?? null) === durationSeconds
    ) {
      return { ok: true, is_pr: Boolean(existing.is_pr), estimated_1rm: estimated1RM(input.weightKg, input.reps) };
    }
  }
  if (error) {
    // A first set the database refused must not leave an empty session behind.
    if (session.created) await supabase.from("logged_sessions").delete().eq("id", sessionId).eq("user_id", userId);
    console.error("logSet", error);
    return { ok: false, message: (await getI18n()).t.clientWidgets.setLogger.couldNotLogSet };
  }

  revalidatePath("/today");
  revalidatePath(`/workout/${input.dayId}`);
  revalidatePath(`/workout/${input.dayId}/log`);
  return { ok: true, is_pr: isPr, estimated_1rm: estimated1RM(input.weightKg, input.reps) };
}



/**
 * Today's session for this program day, creating it only if it does not exist.
 * An upsert would restamp `started_at` on every set, which is what the session
 * list and every "how long did that take" reading are ordered by. Returns the
 * id (and whether this call created it), or an ActionResult to hand straight
 * back to the caller.
 */
async function openSession(
  supabase: LiveUser["supabase"],
  userId: string,
  dayId: string,
  sessionKey: string,
  startedAt: string,
): Promise<{ id: string; created: boolean } | ActionResult> {
  const { data: existing } = await supabase
    .from("logged_sessions")
    .select("id, completed_at")
    .eq("client_generated_id", sessionKey)
    .maybeSingle();

  if (existing) {
    // Logging again after "Finish workout" reopens the session rather than
    // filing new sets under one already marked complete.
    if (existing.completed_at !== null) {
      await supabase
        .from("logged_sessions")
        .update({ completed_at: null })
        .eq("id", existing.id);
    }
    return { id: existing.id as string, created: false };
  }

  const { data: created, error } = await supabase
    .from("logged_sessions")
    .insert({
      user_id: userId,
      program_day_id: dayId,
      client_generated_id: sessionKey,
      started_at: startedAt,
    })
    .select("id")
    .single();
  if (!error) return { id: created.id as string, created: true };

  // A concurrent first set won the insert — adopt the row it created.
  const { data: raced } = await supabase
    .from("logged_sessions")
    .select("id")
    .eq("client_generated_id", sessionKey)
    .maybeSingle();
  return raced ? { id: raced.id as string, created: false } : { ok: false, message: error.message };
}



type HistorySet = { id: string; weight_kg: number | null; reps: number | null; is_pr: boolean; received_at: string };



/**
 * Every set of one lift, oldest first, paged past PostgREST's 1000-row cap so
 * the PR judge never decides on a truncated history.
 */
async function setsOfExercise(
  supabase: LiveUser["supabase"],
  userId: string,
  exerciseId: string,
): Promise<HistorySet[]> {
  const PAGE = 1000;
  const rows: HistorySet[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from("logged_sets")
      .select("id, weight_kg, reps, is_pr, received_at")
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId)
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    rows.push(...((data ?? []) as HistorySet[]));
    if (!data || data.length < PAGE) return rows;
  }
}



async function setErrorMessage(invalid: SetEditError): Promise<string> {
  const m = (await getI18n()).t.clientWidgets.setLogger;
  if (invalid === "weight") return fill(m.errWeight, { max: MAX_SET_WEIGHT_KG, unit: "kg" });
  if (invalid === "reps") return fill(m.errReps, { max: MAX_SET_REPS });
  if (invalid === "duration") return fill(m.errDuration, { max: MAX_SET_SECONDS });
  return invalid === "rpe" ? m.errRpe : m.errRir;
}



/**
 * Correct a set that was logged wrong. Only the owner reaches the row
 * (sets_owner: user_id = auth.uid(), re-checked with .eq below), the values
 * pass the same rules as logging, and the one stored derivative — is_pr — is
 * re-derived over the exercise's history so the flags move with the edit.
 * Volume, training load, the weekly summary, challenges and streaks are all
 * computed at read time from logged_sets, so they follow automatically.
 */
export async function updateLoggedSet(
  setId: string,
  edit: SetEdit,
  dayId?: string | null,
): Promise<ActionResult & { is_pr?: boolean }> {
  const invalid = validateSetEdit(edit);
  if (invalid) return { ok: false, message: await setErrorMessage(invalid) };

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  const { data: row } = await supabase
    .from("logged_sets")
    .select("id, exercise_id")
    .eq("id", setId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return { ok: false, message: "Set not found" };

  const failed = await mutated(
    await supabase
      .from("logged_sets")
      .update(
        {
          weight_kg: edit.weight_kg, reps: edit.reps, rpe: edit.rpe, rir: edit.rir, notes: edit.notes?.trim().slice(0, 500) || null,
          // Only a timed set's edit carries it; a reps edit leaves the column alone.
          ...(edit.duration_seconds != null ? { duration_seconds: edit.duration_seconds } : {}),
        },
        { count: "exact" },
      )
      .eq("id", setId)
      .eq("user_id", userId),
  );
  if (failed) return failed;

  // The PR flags of this lift, re-derived in the order the sets arrived.
  const history = await setsOfExercise(supabase, userId, row.exercise_id as string);
  const changes = recomputePrFlags(
    history.map((s) => ({ ...s, weight_kg: Number(s.weight_kg ?? 0), reps: s.reps ?? 0 })),
    estimated1RM,
  );
  for (const c of changes) {
    await supabase.from("logged_sets").update({ is_pr: c.is_pr }).eq("id", c.id).eq("user_id", userId);
  }
  const isPr = changes.find((c) => c.id === setId)?.is_pr ?? history.find((s) => s.id === setId)?.is_pr ?? false;

  revalidatePath("/today");
  revalidatePath("/workout", "layout");
  revalidatePath("/progress");
  if (dayId) {
    revalidatePath(`/workout/${dayId}`);
    revalidatePath(`/workout/${dayId}/log`);
  }
  return { ok: true, is_pr: isPr };
}



/**
 * Completes today's session for this program day and hands back its id, so the
 * done screen can offer to share it. Only today's — the one logSet() opened
 * under the same key — never every unfinished session of that day: one
 * abandoned last week would otherwise be "finished" now, days long. A second
 * press (or Continue with nothing new logged) finds it already complete and
 * answers with the same id instead of a silent bounce to Today.
 */
export async function finishWorkout(dayId: string): Promise<ActionResult & { sessionId?: string }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const m = (await getI18n()).t.clientWidgets.setLogger;
  const { data: session, error: readError } = await supabase
    .from("logged_sessions")
    .select("id, completed_at")
    .eq("user_id", userId)
    .eq("client_generated_id", sessionKeyFor(userId, dayId, isoDay()))
    .maybeSingle();
  if (readError) return { ok: false, message: m.couldNotFinish };
  if (!session) return { ok: false, message: m.nothingToFinish };
  if (session.completed_at === null) {
    const failed = await mutated(
      await supabase
        .from("logged_sessions")
        .update({ completed_at: new Date().toISOString() }, { count: "exact" })
        .eq("id", session.id)
        .eq("user_id", userId),
    );
    if (failed) return failed;
  }
  revalidatePath("/today");
  revalidatePath("/workout", "layout");
  return { ok: true, sessionId: session.id as string };
}
