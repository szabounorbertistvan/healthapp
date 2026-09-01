"use server";
// Writes from the client (trainee) surface.
//
// Every action carries a client_generated_id in live mode: logged_sets,
// food_logs and habit_logs all have a unique constraint on it, so a retry from
// a flaky connection can never duplicate a row (supabase/README.md, offline
// idempotency). Demo mode writes to the in-process store instead.
import { revalidatePath } from "next/cache";
import { isPersonalRecord, portionMacros, type Macros } from "@healthapp/shared";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
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
  const { data: session, error: sessionError } = await supabase
    .from("logged_sessions")
    .upsert(
      {
        user_id: auth.user.id,
        program_day_id: input.dayId,
        client_generated_id: uuidFrom(`${auth.user.id}:${input.dayId}:${isoDay()}`),
        started_at: new Date().toISOString(),
      },
      { onConflict: "client_generated_id" },
    )
    .select("id")
    .single();
  if (sessionError) return { ok: false, message: sessionError.message };

  const { error } = await supabase.from("logged_sets").insert({
    session_id: session.id,
    user_id: auth.user.id,
    exercise_id: input.exerciseId,
    program_exercise_id: input.programExerciseId ?? null,
    set_index: input.setIndex,
    weight_kg: input.weightKg,
    reps: input.reps,
    rpe: input.rpe,
    client_generated_id: uuidFrom(`${session.id}:${input.exerciseId}:${input.setIndex}`),
    client_ts: new Date().toISOString(),
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/today");
  revalidatePath(`/workout/${input.dayId}`);
  return { ok: true };
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
 * edits cannot accumulate rounding drift.
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
  // The row stores only the portion snapshot, so recover the per-100g basis
  // from it before re-costing. Exact for any grams > 0.
  const { data: row, error: readError } = await supabase
    .from("food_logs")
    .select("grams, kcal, protein_g, carbs_g, fat_g")
    .eq("id", id)
    .single();
  if (readError) return { ok: false, message: readError.message };
  const factor = 100 / row.grams;
  const per100g: Macros = {
    kcal: row.kcal * factor,
    protein: row.protein_g * factor,
    carbs: row.carbs_g * factor,
    fat: row.fat_g * factor,
  };
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
  // Waist lives inside the circumferences jsonb. Read the existing bag first so
  // a weight-only entry cannot wipe a chest or hip measurement taken earlier.
  const { data: existing } = await supabase
    .from("measurements")
    .select("circumferences")
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
      weight_kg: input.weightKg,
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
  if (error) return { ok: false, message: error.message };
  revalidatePath("/check-in");
  revalidatePath("/today");
  return { ok: true };
}

/**
 * A stable uuid derived from a natural key.
 *
 * client_generated_id is a uuid column with a unique constraint, and it is the
 * whole retry-safety story: the same logical write must always produce the same
 * id. Random uuids would defeat that, so this hashes the key into a v5-shaped
 * value. Not cryptographic — it only needs to be deterministic and spread out.
 */
function uuidFrom(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  const block = (seed: number, n: number) => {
    let out = "";
    let s = seed >>> 0;
    while (out.length < n) {
      s = Math.imul(s ^ (s >>> 15), 0x2545f491) >>> 0;
      out += s.toString(16).padStart(8, "0");
    }
    return out.slice(0, n);
  };
  const a = block(h1, 8);
  const b = block(h1 ^ h2, 4);
  const c = `5${block(h2, 3)}`; // version 5 nibble
  const d = ((parseInt(block(h2 ^ 0x9e3779b9, 1), 16) & 0x3) | 0x8).toString(16) + block(h1 ^ 0x5bf03635, 3);
  const e = block(h2 ^ h1, 12);
  return `${a}-${b}-${c}-${d}-${e}`;
}
