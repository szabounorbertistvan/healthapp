"use server";
// Writes from the client (trainee) surface.
//
// Every action carries a client_generated_id in live mode: logged_sets,
// food_logs and habit_logs all have a unique constraint on it, so a retry from
// a flaky connection can never duplicate a row (supabase/README.md, offline
// idempotency). Demo mode writes to the in-process store instead.
import { revalidatePath } from "next/cache";
import { isPersonalRecord, portionMacros, type Macros } from "@buddygym/shared";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import {
  DEMO_CLIENT_ID,
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
    const cs = clientStore();
    let session = cs.sessions.find(
      (s) => s.client_id === DEMO_CLIENT_ID && s.program_day_id === input.dayId && s.completed_at === null,
    );
    if (!session) {
      session = {
        id: newId("ls"),
        client_id: DEMO_CLIENT_ID,
        program_day_id: input.dayId,
        day_name: input.dayName,
        started_at: new Date().toISOString(),
        completed_at: null,
      };
      cs.sessions.push(session);
    }
    const best = bestFor(DEMO_CLIENT_ID, input.exerciseName);
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

  const { data: session, error: sessionError } = await supabase
    .from("logged_sessions")
    .upsert(
      {
        client_id: auth.user.id,
        program_day_id: input.dayId,
        client_generated_id: `${auth.user.id}:${input.dayId}:${isoDay()}`,
        started_at: new Date().toISOString(),
      },
      { onConflict: "client_generated_id" },
    )
    .select("id")
    .single();
  if (sessionError) return { ok: false, message: sessionError.message };

  const { error } = await supabase.from("logged_sets").insert({
    session_id: session.id,
    set_index: input.setIndex,
    weight_kg: input.weightKg,
    reps: input.reps,
    rpe: input.rpe,
    client_generated_id: `${session.id}:${input.exerciseName}:${input.setIndex}`,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/today");
  revalidatePath(`/workout/${input.dayId}`);
  return { ok: true };
}

export async function finishWorkout(dayId: string): Promise<ActionResult> {
  if (isDemo) {
    const cs = clientStore();
    const session = cs.sessions.find(
      (s) => s.client_id === DEMO_CLIENT_ID && s.program_day_id === dayId && s.completed_at === null,
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
    .eq("client_id", auth.user.id)
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
    clientStore().foodLogs.push({
      id: newId("fl"),
      client_id: DEMO_CLIENT_ID,
      logged_on: day,
      slot: input.slot,
      food_name: input.foodName,
      grams: input.grams,
      macros,
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
    client_id: auth.user.id,
    logged_on: day,
    slot: input.slot,
    food_name: input.foodName,
    grams: input.grams,
    kcal: macros.kcal,
    protein_g: macros.protein,
    carbs_g: macros.carbs,
    fat_g: macros.fat,
    client_generated_id: newId("fl"),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/food");
  revalidatePath("/today");
  return { ok: true };
}

export async function deleteFoodLog(id: string): Promise<ActionResult> {
  if (isDemo) {
    const cs = clientStore();
    const index = cs.foodLogs.findIndex((f) => f.id === id);
    if (index >= 0) cs.foodLogs.splice(index, 1);
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
  const { data: existing } = await supabase
    .from("habit_logs")
    .select("id")
    .eq("habit_id", habitId)
    .eq("done_on", day)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("habit_logs").delete().eq("id", existing.id)
    : await supabase.from("habit_logs").insert({
        habit_id: habitId,
        done_on: day,
        client_generated_id: `${habitId}:${day}`,
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
    clientStore().habits.push({
      id: newId("hb"),
      client_id: DEMO_CLIENT_ID,
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
  const { error } = await supabase.from("habits").insert({
    client_id: auth.user.id,
    name: name.trim(),
    target_per_week: target,
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
    const cs = clientStore();
    const existing = cs.measurements.find(
      (m) => m.client_id === DEMO_CLIENT_ID && m.taken_on === takenOn,
    );
    if (existing) {
      existing.weight_kg = input.weightKg ?? existing.weight_kg;
      existing.waist_cm = input.waistCm ?? existing.waist_cm;
    } else {
      cs.measurements.push({
        id: newId("me"),
        client_id: DEMO_CLIENT_ID,
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
  const { error } = await supabase.from("measurements").upsert(
    {
      client_id: auth.user.id,
      taken_on: takenOn,
      weight_kg: input.weightKg,
      waist_cm: input.waistCm,
    },
    { onConflict: "client_id,taken_on" },
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
    const cs = clientStore();
    if (cs.checkIns.some((c) => c.client_id === DEMO_CLIENT_ID && c.week_start === weekStart)) {
      return { ok: false, message: "This week is already checked in" };
    }
    cs.checkIns.push({
      id: newId("ci"),
      client_id: DEMO_CLIENT_ID,
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
    client_id: auth.user.id,
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
