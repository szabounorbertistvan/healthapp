"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { newId, store, type StoredProgram, type StoredProgramDay } from "@/lib/demo-store";
import { viewingClientId } from "@/lib/view-mode";
import type { ActionResult } from "./actions";

// Program builder writes (W4, Sprint 3).
//
// Two branches, same as lib/data.ts: the demo store when no backend is
// configured, Supabase otherwise. The Supabase branch has never run against a
// live database — there is no Docker on the dev machine yet — so treat it as
// written-to-schema, not verified.

export async function createProgram(input: {
  name: string;
  clientId: string;
  clientName: string;
  weeks: number;
  intensityMode: "rpe" | "rir" | "simple";
}): Promise<ActionResult & { id?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the program a name" };
  if (!input.clientId) return { ok: false, message: "Pick a client" };

  if (isDemo) {
    const program: StoredProgram = {
      id: newId("p"),
      client_id: input.clientId,
      client_name: input.clientName,
      name,
      status: "draft", // never visible to the client until Publish (spec B1)
      intensity_mode: input.intensityMode,
      weeks: input.weeks,
      updated_at: new Date().toISOString(),
      days: [],
    };
    store().programs.unshift(program);
    revalidatePath("/programs");
    return { ok: true, demo: true, id: program.id };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { data, error } = await supabase
    .from("programs")
    .insert({
      coach_id: auth.user.id,
      client_id: input.clientId,
      name,
      weeks: input.weeks,
      intensity_mode: input.intensityMode,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/programs");
  return { ok: true, id: data.id };
}

export async function addProgramDay(programId: string, name: string): Promise<ActionResult> {
  const dayName = name.trim() || "New day";

  if (isDemo) {
    const program = find(programId);
    if (!program) return { ok: false, message: "Program not found" };
    program.days.push({
      id: newId("pd"),
      week_index: 1,
      day_index: program.days.length,
      name: dayName,
      exercises: [],
    });
    touch(program);
    revalidatePath(`/programs/${programId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("program_days")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  const { error } = await supabase.from("program_days").insert({
    program_id: programId,
    week_index: 1,
    day_index: count ?? 0,
    name: dayName,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/programs/${programId}`);
  return { ok: true };
}

export async function addProgramExercise(input: {
  programId: string;
  dayId: string;
  exerciseId: string;
  exerciseName: string;
}): Promise<ActionResult> {
  if (isDemo) {
    const program = find(input.programId);
    const day = findDay(input.programId, input.dayId);
    if (!program || !day) return { ok: false, message: "Day not found" };
    day.exercises.push({
      id: newId("pe"),
      exercise_id: input.exerciseId,
      exercise_name: input.exerciseName,
      position: day.exercises.length,
      // Sensible starting targets — the coach edits them in place.
      target_sets: 3,
      target_reps: "10",
      target_weight_kg: null,
      target_rpe: null,
      rest_seconds: 90,
      notes: null,
    });
    touch(program);
    revalidatePath(`/programs/${input.programId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("program_exercises")
    .select("id", { count: "exact", head: true })
    .eq("program_day_id", input.dayId);
  const { error } = await supabase.from("program_exercises").insert({
    program_day_id: input.dayId,
    exercise_id: input.exerciseId,
    position: count ?? 0,
    target_sets: 3,
    target_reps: "10",
    rest_seconds: 90,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/programs/${input.programId}`);
  return { ok: true };
}

export async function updateProgramExercise(input: {
  programId: string;
  exerciseRowId: string;
  target_sets: number;
  target_reps: string;
  target_weight_kg: number | null;
  target_rpe: number | null;
  rest_seconds: number | null;
}): Promise<ActionResult> {
  if (input.target_sets < 1 || input.target_sets > 20) {
    return { ok: false, message: "Sets must be between 1 and 20" };
  }

  if (isDemo) {
    const program = find(input.programId);
    const row = program?.days.flatMap((d) => d.exercises).find((e) => e.id === input.exerciseRowId);
    if (!program || !row) return { ok: false, message: "Exercise not found" };
    row.target_sets = input.target_sets;
    row.target_reps = input.target_reps;
    row.target_weight_kg = input.target_weight_kg;
    row.target_rpe = input.target_rpe;
    row.rest_seconds = input.rest_seconds;
    touch(program);
    revalidatePath(`/programs/${input.programId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("program_exercises")
    .update({
      target_sets: input.target_sets,
      target_reps: input.target_reps,
      target_weight_kg: input.target_weight_kg,
      target_rpe: input.target_rpe,
      rest_seconds: input.rest_seconds,
    })
    .eq("id", input.exerciseRowId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/programs/${input.programId}`);
  return { ok: true };
}

export async function removeProgramExercise(
  programId: string,
  exerciseRowId: string,
): Promise<ActionResult> {
  if (isDemo) {
    const program = find(programId);
    if (!program) return { ok: false, message: "Program not found" };
    for (const day of program.days) {
      day.exercises = day.exercises.filter((e) => e.id !== exerciseRowId);
      day.exercises.forEach((e, index) => {
        e.position = index;
      });
    }
    touch(program);
    revalidatePath(`/programs/${programId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.from("program_exercises").delete().eq("id", exerciseRowId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/programs/${programId}`);
  return { ok: true };
}

/** Duplicate a day with all its targets — the build-once move from W4. */
export async function duplicateProgramDay(programId: string, dayId: string): Promise<ActionResult> {
  if (isDemo) {
    const program = find(programId);
    const day = program?.days.find((d) => d.id === dayId);
    if (!program || !day) return { ok: false, message: "Day not found" };
    program.days.push({
      id: newId("pd"),
      week_index: day.week_index,
      day_index: program.days.length,
      name: `${day.name} (copy)`,
      exercises: day.exercises.map((e) => ({ ...e, id: newId("pe") })),
    });
    touch(program);
    revalidatePath(`/programs/${programId}`);
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { data: source, error: readError } = await supabase
    .from("program_days")
    .select(
      "week_index, name, program_exercises(exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds, notes)",
    )
    .eq("id", dayId)
    .single();
  if (readError) return { ok: false, message: readError.message };

  const { count } = await supabase
    .from("program_days")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  const { data: created, error: writeError } = await supabase
    .from("program_days")
    .insert({
      program_id: programId,
      week_index: source.week_index,
      day_index: count ?? 0,
      name: `${source.name} (copy)`,
    })
    .select("id")
    .single();
  if (writeError) return { ok: false, message: writeError.message };

  const rows = (source.program_exercises ?? []).map((e) => ({
    ...e,
    program_day_id: created.id,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from("program_exercises").insert(rows);
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/programs/${programId}`);
  return { ok: true };
}

/** Publish makes the program visible to the client and fires Plan updated. */
export async function publishProgram(programId: string): Promise<ActionResult> {
  if (isDemo) {
    const program = find(programId);
    if (!program) return { ok: false, message: "Program not found" };
    // Acceptance criterion B1: at least one day with at least one exercise.
    if (program.days.every((d) => d.exercises.length === 0)) {
      return { ok: false, message: "Add at least one exercise before publishing" };
    }
    program.status = "published";
    touch(program);
    revalidatePath(`/programs/${programId}`);
    revalidatePath("/programs");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("programs")
    .update({ status: "published" })
    .eq("id", programId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/programs/${programId}`);
  revalidatePath("/programs");
  return { ok: true };
}

function find(programId: string): StoredProgram | undefined {
  return store().programs.find((p) => p.id === programId);
}

function findDay(programId: string, dayId: string): StoredProgramDay | undefined {
  return find(programId)?.days.find((d) => d.id === dayId);
}

function touch(program: StoredProgram): void {
  program.updated_at = new Date().toISOString();
}

/**
 * A program the client owns outright: coach_id null, client_id themselves.
 *
 * The values are not merely a convention — policy programs_solo_all rejects any
 * other combination, so a client cannot write a program for someone else even
 * if this action were called with different arguments.
 */
export async function createSoloProgram(input: {
  name: string;
  intensityMode: "rpe" | "rir" | "simple";
}): Promise<ActionResult & { id?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the program a name" };

  if (isDemo) {
    const program: StoredProgram = {
      id: newId("p"),
      client_id: await viewingClientId(),
      client_name: "You",
      name,
      status: "draft",
      intensity_mode: input.intensityMode,
      weeks: 1,
      updated_at: new Date().toISOString(),
      days: [],
    };
    store().programs.unshift(program);
    revalidatePath("/workout");
    return { ok: true, demo: true, id: program.id };
  }

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { data, error } = await supabase
    .from("programs")
    .insert({
      coach_id: null,
      client_id: auth.user.id,
      name,
      weeks: 1,
      intensity_mode: input.intensityMode,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/workout");
  return { ok: true, id: data.id };
}

/** Like addProgramDay, but carries the muscle groups the client chose. */
export async function addSoloProgramDay(
  programId: string,
  name: string,
  muscleGroups: string[],
): Promise<ActionResult> {
  const dayName = name.trim() || "New day";

  if (isDemo) {
    const program = store().programs.find((p) => p.id === programId);
    if (!program) return { ok: false, message: "Program not found" };
    program.days.push({
      id: newId("pd"),
      week_index: 1,
      day_index: program.days.length,
      name: dayName,
      exercises: [],
    });
    touch(program);
    revalidatePath("/workout/build");
    return { ok: true, demo: true };
  }

  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("program_days")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  const { error } = await supabase.from("program_days").insert({
    program_id: programId,
    week_index: 1,
    day_index: count ?? 0,
    name: dayName,
    muscle_groups: muscleGroups,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/workout/build");
  return { ok: true };
}

/** The client's own draft-or-published program, if they have started one. */
export async function getMySoloProgramId(): Promise<string | null> {
  if (isDemo) {
    const clientId = await viewingClientId();
    // Demo's StoredProgram carries no coach_id, so this cannot tell a solo
    // program apart from one the coach built for the same client — it is
    // scoped to the viewed client, then picks their most recently updated
    // program. See task-4-report.md for the residual gap this leaves for the
    // seeded demo client, who already has a coach-authored program.
    const mine = store()
      .programs.filter((p) => p.client_id === clientId)
      .sort((a, b) => (a.updated_at > b.updated_at ? -1 : 1));
    return mine[0]?.id ?? null;
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("programs")
    .select("id")
    .eq("client_id", auth.user.id)
    .is("coach_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
