"use server";
// Writes from the client (trainee) surface.
//
// Every action carries a client_generated_id in live mode: logged_sets,
// food_logs and habit_logs all have a unique constraint on it, so a retry from
// a flaky connection can never duplicate a row (supabase/README.md, offline
// idempotency). Demo mode writes to the in-process store instead.
import { revalidatePath } from "next/cache";
import { estimated1RM, isPersonalRecord, portionMacros, type Macros } from "@buddygym/shared";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { sessionKeyFor, uuidFrom } from "@/lib/stable-id";
import { viewingClientId } from "@/lib/view-mode";
import {

  bestFor,
  clientStore,
  isoDay,
  mondayOf,
  newId,
  type MealSlot,
} from "@/lib/demo-client-store";
import type { ActionResult } from "./actions";

export type LogSetResult = ActionResult & { is_pr?: boolean; estimated_1rm?: number };

/**
 * Log one set. PR detection runs here against the best estimated 1RM so far —
 * the same isPersonalRecord() the mobile app calls the instant a set is
 * confirmed, so the two verdicts cannot disagree.
 */
export async function logSet(input: {
  dayId: string;
  dayName: string;
  exerciseName: string;
  /** exercises.id — required live, absent in demo where exercises are names. */
  exerciseId?: string | null;
  /** program_exercises.id, so a set can be traced back to what was prescribed. */
  programExerciseId?: string | null;
  setIndex: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
}): Promise<LogSetResult> {
  if (!Number.isFinite(input.weightKg) || input.weightKg < 0) {
    return { ok: false, message: "Weight must be a positive number" };
  }
  if (!Number.isInteger(input.reps) || input.reps <= 0) {
    return { ok: false, message: "Reps must be a whole number above zero" };
  }

  if (isDemo) {
    const clientId = await viewingClientId();
    const cs = clientStore();
    let session = cs.sessions.find(
      (s) => s.client_id === clientId && s.program_day_id === input.dayId && s.completed_at === null,
    );
    if (!session) {
      session = {
        id: newId("ls"),
        client_id: clientId,
        program_day_id: input.dayId,
        day_name: input.dayName,
        started_at: new Date().toISOString(),
        completed_at: null,
      };
      cs.sessions.push(session);
    }
    const best = bestFor(clientId, input.exerciseName);
    const isPr = isPersonalRecord({ weight: input.weightKg, reps: input.reps }, best);
    cs.sets.push({
      id: newId("lst"),
      session_id: session.id,
      program_exercise_id: input.programExerciseId ?? null,
      exercise_name: input.exerciseName,
      set_index: input.setIndex,
      weight_kg: input.weightKg,
      reps: input.reps,
      rpe: input.rpe,
      is_pr: isPr,
      logged_at: new Date().toISOString(),
    });
    revalidatePath("/today");
    revalidatePath(`/workout/${input.dayId}`);
    return { ok: true, demo: true, is_pr: isPr };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };

  if (!input.exerciseId) {
    // logged_sets.exercise_id is NOT NULL and there is no name lookup here on
    // purpose: guessing an exercise by name would silently log against the
    // wrong row. The program screens carry the id through instead.
    return { ok: false, message: "This exercise is missing its library link" };
  }

  // client_generated_id is a uuid column, and it is what makes a retry safe.
  // Deriving it from the day and date keeps one session per day per program
  // day however many times this runs.
  const sessionKey = sessionKeyFor(auth.user.id, input.dayId, isoDay());
  const sessionId = await openSession(supabase, auth.user.id, input.dayId, sessionKey);
  if (typeof sessionId !== "string") return sessionId;

  // The same PR check the demo path and the mobile app run, against the best
  // estimated 1RM already on record for this lift. Bounded by the
  // (user_id, exercise_id, received_at) index rather than reading a lifetime.
  const { data: history } = await supabase
    .from("logged_sets")
    .select("weight_kg, reps")
    .eq("user_id", auth.user.id)
    .eq("exercise_id", input.exerciseId)
    .order("received_at", { ascending: false })
    .limit(200);
  const best = (history ?? []).reduce(
    (max, s) => Math.max(max, estimated1RM(s.weight_kg ?? 0, s.reps ?? 0)),
    0,
  );
  const isPr = isPersonalRecord(
    { weight: input.weightKg, reps: input.reps },
    best > 0 ? best : null,
  );

  const { error } = await supabase.from("logged_sets").insert({
    session_id: sessionId,
    user_id: auth.user.id,
    exercise_id: input.exerciseId,
    program_exercise_id: input.programExerciseId ?? null,
    set_index: input.setIndex,
    weight_kg: input.weightKg,
    reps: input.reps,
    rpe: input.rpe,
    is_pr: isPr,
    // Keyed on the prescribed row, not the library exercise: a day may program
    // the same lift twice (heavy, then a back-off block) and each keeps its own
    // set numbering.
    client_generated_id: uuidFrom(
      `${sessionId}:${input.programExerciseId ?? input.exerciseId}:${input.setIndex}`,
    ),
    client_ts: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/today");
  revalidatePath(`/workout/${input.dayId}`);
  return { ok: true, is_pr: isPr, estimated_1rm: estimated1RM(input.weightKg, input.reps) };
}

/**
 * Today's session for this program day, creating it only if it does not exist.
 * An upsert would restamp `started_at` on every set, which is what the session
 * list and every "how long did that take" reading are ordered by. Returns the
 * id, or an ActionResult to hand straight back to the caller.
 */
async function openSession(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  dayId: string,
  sessionKey: string,
): Promise<string | ActionResult> {
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
    return existing.id as string;
  }

  const { data: created, error } = await supabase
    .from("logged_sessions")
    .insert({
      user_id: userId,
      program_day_id: dayId,
      client_generated_id: sessionKey,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (!error) return created.id as string;

  // A concurrent first set won the insert — adopt the row it created.
  const { data: raced } = await supabase
    .from("logged_sessions")
    .select("id")
    .eq("client_generated_id", sessionKey)
    .maybeSingle();
  return raced ? (raced.id as string) : { ok: false, message: error.message };
}

export async function finishWorkout(dayId: string): Promise<ActionResult> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const cs = clientStore();
    const session = cs.sessions.find(
      (s) => s.client_id === clientId && s.program_day_id === dayId && s.completed_at === null,
    );
    if (!session) return { ok: false, message: "Nothing logged yet" };
    session.completed_at = new Date().toISOString();
    revalidatePath("/today");
    revalidatePath("/workout");
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { error } = await supabase
    .from("logged_sessions")
    .update({ completed_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .eq("program_day_id", dayId)
    .is("completed_at", null);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/today");
  revalidatePath("/workout");
  return { ok: true };
}

export async function logFood(input: {
  slot: MealSlot;
  foodName: string;
  grams: number;
  per100g: Macros;
  /** foods.id, so a later portion edit can re-cost from the unrounded basis. */
  foodId?: string | null;
  day?: string;
}): Promise<ActionResult> {
  if (!input.foodName.trim()) return { ok: false, message: "Pick a food" };
  if (!Number.isFinite(input.grams) || input.grams <= 0) {
    return { ok: false, message: "Grams must be above zero" };
  }
  const day = input.day ?? isoDay();
  // Snapshot the macros now: the food row may change, this log must not.
  const macros = portionMacros(input.per100g, input.grams);

  if (isDemo) {
    const clientId = await viewingClientId();
    clientStore().foodLogs.push({
      id: newId("fl"),
      client_id: clientId,
      logged_on: day,
      slot: input.slot,
      food_name: input.foodName,
      grams: input.grams,
      macros,
      per_100g: input.per100g,
      logged_at: new Date().toISOString(),
    });
    revalidatePath("/food");
    revalidatePath("/today");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { error } = await supabase.from("food_logs").insert({
    user_id: auth.user.id,
    date: day,
    slot: input.slot,
    food_id: asUuid(input.foodId),
    food_name: input.foodName,
    grams: input.grams,
    kcal: macros.kcal,
    protein_g: macros.protein,
    carbs_g: macros.carbs,
    fat_g: macros.fat,
    client_generated_id: crypto.randomUUID(),
    client_ts: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}

/**
 * Correct a portion that was logged wrong. Macros are re-derived from the
 * per-100g basis rather than scaled from the stored snapshot, so repeated
 * edits cannot accumulate rounding drift. The basis comes from the linked
 * `foods` row where there is one; recovering it from the snapshot is only the
 * fallback, because that snapshot is rounded (kcal to a whole number, macros to
 * 0.1 g) and a small portion divides that error back up by 100/grams.
 */
export async function updateFoodLog(id: string, grams: number): Promise<ActionResult> {
  if (!Number.isFinite(grams) || grams <= 0) {
    return { ok: false, message: "Grams must be above zero" };
  }

  if (isDemo) {
    const clientId = await viewingClientId();
    // Scope by client as well as id: RLS does this in live mode, and the demo
    // store has no such guard while an admin can switch between clients.
    const entry = clientStore().foodLogs.find((f) => f.id === id && f.client_id === clientId);
    if (!entry) return { ok: false, message: "That entry is gone" };
    entry.grams = grams;
    entry.macros = portionMacros(entry.per_100g, grams);
    revalidatePath("/food");
    revalidatePath("/today");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { data: row, error: readError } = await supabase
    .from("food_logs")
    .select("grams, kcal, protein_g, carbs_g, fat_g, food_id")
    .eq("id", id)
    .single();
  if (readError) return { ok: false, message: readError.message };

  let per100g: Macros | null = null;
  if (row.food_id) {
    const { data: food } = await supabase
      .from("foods")
      .select("kcal_100g, protein_100g, carbs_100g, fat_100g")
      .eq("id", row.food_id)
      .maybeSingle();
    if (food) {
      per100g = {
        kcal: Number(food.kcal_100g),
        protein: Number(food.protein_100g),
        carbs: Number(food.carbs_100g),
        fat: Number(food.fat_100g),
      };
    }
  }
  if (!per100g) {
    // Older rows (and custom entries) carry no food link — scale the snapshot
    // and accept the rounding it was already stored with.
    const factor = 100 / row.grams;
    per100g = {
      kcal: row.kcal * factor,
      protein: row.protein_g * factor,
      carbs: row.carbs_g * factor,
      fat: row.fat_g * factor,
    };
  }
  const macros = portionMacros(per100g, grams);

  const { error } = await supabase
    .from("food_logs")
    .update({
      grams,
      kcal: macros.kcal,
      protein_g: macros.protein,
      carbs_g: macros.carbs,
      fat_g: macros.fat,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}

export async function deleteFoodLog(id: string): Promise<ActionResult> {
  if (isDemo) {
    const clientId = await viewingClientId();
    const cs = clientStore();
    const index = cs.foodLogs.findIndex((f) => f.id === id && f.client_id === clientId);
    if (index < 0) return { ok: false, message: "That entry is gone" };
    cs.foodLogs.splice(index, 1);
    revalidatePath("/food");
    revalidatePath("/today");
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.from("food_logs").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}

export async function toggleHabit(habitId: string, day = isoDay()): Promise<ActionResult> {
  if (isDemo) {
    const cs = clientStore();
    const index = cs.habitLogs.findIndex((l) => l.habit_id === habitId && l.done_on === day);
    if (index >= 0) cs.habitLogs.splice(index, 1);
    else cs.habitLogs.push({ id: newId("hl"), habit_id: habitId, done_on: day });
    revalidatePath("/today");
    revalidatePath("/habits");
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { data: existing } = await supabase
    .from("habit_logs")
    .select("id")
    .eq("habit_id", habitId)
    .eq("date", day)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("habit_logs").delete().eq("id", existing.id)
    : await supabase.from("habit_logs").insert({
        habit_id: habitId,
        user_id: auth.user.id,
        date: day,
        client_generated_id: uuidFrom(`${habitId}:${day}`),
      });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/today");
  revalidatePath("/habits");
  return { ok: true };
}

export async function addHabit(name: string, targetPerWeek: number): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, message: "Give the habit a name" };
  const target = Math.min(Math.max(Math.round(targetPerWeek) || 7, 1), 7);
  if (isDemo) {
    const clientId = await viewingClientId();
    clientStore().habits.push({
      id: newId("hb"),
      client_id: clientId,
      name: name.trim(),
      target_per_week: target,
      archived: false,
    });
    revalidatePath("/habits");
    revalidatePath("/today");
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  // No target_per_week column: scheduling is `weekdays int[]` with 0=Sun. A
  // target of n means the first n days of the week, which is the closest this
  // simple form can express — a real weekday picker is the proper fix.
  const weekdays = Array.from({ length: target }, (_, i) => i);
  const { error } = await supabase.from("habits").insert({
    user_id: auth.user.id,
    created_by: auth.user.id,
    name: name.trim(),
    weekdays,
    active: true,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/habits");
  return { ok: true };
}

export async function addMeasurement(input: {
  weightKg: number | null;
  waistCm: number | null;
  takenOn?: string;
}): Promise<ActionResult> {
  if (input.weightKg === null && input.waistCm === null) {
    return { ok: false, message: "Enter a weight or a waist measurement" };
  }
  const takenOn = input.takenOn ?? isoDay();
  if (isDemo) {
    const clientId = await viewingClientId();
    const cs = clientStore();
    const existing = cs.measurements.find(
      (m) => m.client_id === clientId && m.taken_on === takenOn,
    );
    if (existing) {
      existing.weight_kg = input.weightKg ?? existing.weight_kg;
      existing.waist_cm = input.waistCm ?? existing.waist_cm;
    } else {
      cs.measurements.push({
        id: newId("me"),
        client_id: clientId,
        taken_on: takenOn,
        weight_kg: input.weightKg,
        waist_cm: input.waistCm,
      });
    }
    revalidatePath("/progress");
    revalidatePath("/today");
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  // The upsert replaces the whole row, so read what is already there first.
  // Waist lives inside the circumferences jsonb, and weight_kg is a plain
  // column — both have to be carried forward, or a waist-only entry in the
  // evening blanks the morning's weigh-in (and vice versa).
  const { data: existing } = await supabase
    .from("measurements")
    .select("weight_kg, circumferences")
    .eq("user_id", auth.user.id)
    .eq("date", takenOn)
    .maybeSingle();
  const circumferences: Record<string, number> = {
    ...((existing?.circumferences as Record<string, number> | null) ?? {}),
  };
  if (input.waistCm !== null) circumferences.waist = input.waistCm;

  const { error } = await supabase.from("measurements").upsert(
    {
      user_id: auth.user.id,
      date: takenOn,
      weight_kg: input.weightKg ?? existing?.weight_kg ?? null,
      circumferences,
    },
    { onConflict: "user_id,date" },
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/progress");
  return { ok: true };
}

export async function submitCheckIn(input: {
  weightKg: number | null;
  sleep: number;
  energy: number;
  stress: number;
  hunger: number;
  recovery: number;
  note: string;
}): Promise<ActionResult> {
  const weekStart = mondayOf(0);
  if (isDemo) {
    const clientId = await viewingClientId();
    const cs = clientStore();
    if (cs.checkIns.some((c) => c.client_id === clientId && c.week_start === weekStart)) {
      return { ok: false, message: "This week is already checked in" };
    }
    cs.checkIns.push({
      id: newId("ci"),
      client_id: clientId,
      week_start: weekStart,
      weight_kg: input.weightKg,
      sleep: input.sleep,
      energy: input.energy,
      stress: input.stress,
      hunger: input.hunger,
      recovery: input.recovery,
      note: input.note.trim() || null,
      submitted_at: new Date().toISOString(),
      coach_reviewed_at: null,
      coach_feedback: null,
    });
    // A check-in is also a weigh-in — keep the two surfaces agreeing.
    if (input.weightKg !== null) {
      await addMeasurement({ weightKg: input.weightKg, waistCm: null });
    }
    revalidatePath("/check-in");
    revalidatePath("/today");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  // check_ins is unique on (user_id, week_start). Say so in words rather than
  // letting the constraint violation reach the form, and mirror the demo guard.
  const { data: already } = await supabase
    .from("check_ins")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (already) return { ok: false, message: "This week is already checked in" };

  const { error } = await supabase.from("check_ins").insert({
    user_id: auth.user.id,
    week_start: weekStart,
    weight_kg: input.weightKg,
    sleep: input.sleep,
    energy: input.energy,
    stress: input.stress,
    hunger: input.hunger,
    recovery: input.recovery,
    note: input.note.trim() || null,
    submitted_at: new Date().toISOString(),
  });
  // A double tap can still race past the check above; 23505 means the same thing.
  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? "This week is already checked in" : error.message,
    };
  }
  revalidatePath("/check-in");
  revalidatePath("/today");
  return { ok: true };
}

/** PostgREST wants null, not a demo-store id or a barcode, in a uuid column. */
function asUuid(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

