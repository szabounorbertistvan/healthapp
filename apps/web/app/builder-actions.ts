"use server";
import { revalidatePath } from "next/cache";
import { DEFAULT_TARGETS, swapNeighbour, validateTargets, type ExerciseTargets } from "@healthapp/shared";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

// Program builder writes (W4, Sprint 3).
//
// Driven end-to-end against the live project on 2026-09-14: create → add day →
// add exercise → set sets/reps/RIR/rest → publish, then confirmed the client's
// Today picked the program up. Every update/delete goes through `mutated()` so
// an RLS-filtered write cannot report success.
//
// day_index is the 0-based ordinal of a day *within its week*, which is what
// the unique key (program_id, week_index, day_index) assumes. Only the sort
// reads it, so a hole left by a deleted day is harmless — see nextDayIndex().

/**
 * The next free ordinal inside a week.
 *
 * Not the number of days: deleting a day leaves a hole — the row is gone, the
 * days after it keep the index they had — so counting them hands back an index
 * that is still taken and the (program_id, week_index, day_index) unique key
 * rejects the insert. The highest index plus one is free whatever the holes
 * look like, and nothing but the sort reads day_index.
 */
async function nextDayIndex(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  programId: string,
  weekIndex: number,
): Promise<number> {
  const { data } = await supabase
    .from("program_days")
    .select("day_index")
    .eq("program_id", programId)
    .eq("week_index", weekIndex)
    .order("day_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.day_index as number | undefined) ?? -1) + 1;
}

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


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("programs")
    .insert({
      coach_id: userId,
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


  const supabase = await supabaseServer();
  const dayIndex = await nextDayIndex(supabase, programId, 1);
  const { error } = await supabase.from("program_days").insert({
    program_id: programId,
    week_index: 1,
    day_index: dayIndex,
    name: dayName,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/programs/${programId}`);
  return { ok: true };
}

/** Every route that shows a program: the coach's builder, the client's builder and their Training list. */
function programTouched(programId: string) {
  revalidatePath(`/programs/${programId}`);
  revalidatePath("/workout/build");
  revalidatePath("/workout", "layout");
  revalidatePath("/today");
}

function targetsMessage(error: ReturnType<typeof validateTargets>): string {
  switch (error) {
    case "sets": return "Sets must be between 1 and 20";
    case "reps": return "Reps must be a number or a range like 8-10";
    case "rpe": return "RIR / RPE must be between 0 and 10";
    case "rest": return "Rest must be between 0 and 600 seconds";
    case "weight": return "Weight must be zero or more";
    default: return "Check the values";
  }
}

/**
 * Add an exercise to a day with its prescription. The targets come from the
 * form the picker shows before adding (sets, reps, RIR/RPE, rest); when a
 * caller omits them the defaults are a real prescription (3 × 10, RIR 2, 90 s)
 * that the row then shows for editing.
 */
export async function addProgramExercise(input: {
  programId: string;
  dayId: string;
  exerciseId: string;
  exerciseName: string;
  targets?: Partial<ExerciseTargets>;
  circuit?: number | null;
}): Promise<ActionResult> {
  const targets: ExerciseTargets = { ...DEFAULT_TARGETS, ...input.targets };
  const invalid = validateTargets(targets);
  if (invalid) return { ok: false, message: targetsMessage(invalid) };

  const supabase = await supabaseServer();
  const { data: last } = await supabase
    .from("program_exercises")
    .select("position")
    .eq("program_day_id", input.dayId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("program_exercises").insert({
    program_day_id: input.dayId,
    exercise_id: input.exerciseId,
    position: ((last?.position as number | undefined) ?? -1) + 1,
    ...targets,
    circuit: input.circuit ?? null,
  });
  if (error) return { ok: false, message: error.message };
  programTouched(input.programId);
  return { ok: true };
}

/** Rename a training day. The name is what the client sees on Training and in history. */
export async function renameProgramDay(programId: string, dayId: string, name: string): Promise<ActionResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, message: "Give the day a name" };
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_days").update({ name: clean }, { count: "exact" }).eq("id", dayId).eq("program_id", programId),
  );
  if (failed) return failed;
  programTouched(programId);
  return { ok: true };
}

/**
 * Move a day one step up or down. The swap happens inside move_program_day()
 * — the unique (program, week, day_index) key needs the two updates to be one
 * transaction. Sessions reference the day's id, so history is untouched.
 */
export async function moveProgramDay(programId: string, dayId: string, direction: -1 | 1): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("move_program_day", { p_day: dayId, p_direction: direction });
  if (error) return { ok: false, message: error.code === "42501" ? "You cannot edit this program" : error.message };
  programTouched(programId);
  return { ok: true };
}

/** Move an exercise one step up or down inside its day (swap with its neighbour). */
export async function moveProgramExercise(programId: string, dayId: string, rowId: string, direction: -1 | 1): Promise<ActionResult> {
  const supabase = await supabaseServer();
  const { data: rows, error } = await supabase.from("program_exercises").select("id, position").eq("program_day_id", dayId);
  if (error) return { ok: false, message: error.message };
  const updates = swapNeighbour((rows ?? []) as { id: string; position: number }[], rowId, direction);
  for (const u of updates) {
    const failed = await mutated(
      await supabase.from("program_exercises").update({ position: u.position }, { count: "exact" }).eq("id", u.id).eq("program_day_id", dayId),
    );
    if (failed) return failed;
  }
  programTouched(programId);
  return { ok: true };
}

/** Link an exercise into a circuit (1 = A, 2 = B …) or take it out (null). */
export async function setExerciseCircuit(programId: string, rowId: string, circuit: number | null): Promise<ActionResult> {
  if (circuit !== null && (!Number.isInteger(circuit) || circuit < 1 || circuit > 26)) return { ok: false, message: "Unknown circuit" };
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_exercises").update({ circuit }, { count: "exact" }).eq("id", rowId),
  );
  if (failed) return failed;
  programTouched(programId);
  return { ok: true };
}

/** Swap the exercise a prescribed row points at, keeping its sets/reps/RIR. Past sets keep their own exercise_id. */
export async function replaceProgramExercise(programId: string, rowId: string, exerciseId: string): Promise<ActionResult> {
  if (!exerciseId) return { ok: false, message: "Pick an exercise" };
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_exercises").update({ exercise_id: exerciseId }, { count: "exact" }).eq("id", rowId),
  );
  if (failed) return failed;
  programTouched(programId);
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
  const invalid = validateTargets(input);
  if (invalid) return { ok: false, message: targetsMessage(invalid) };

  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase
      .from("program_exercises")
      .update(
        {
          target_sets: input.target_sets,
          target_reps: input.target_reps,
          target_weight_kg: input.target_weight_kg,
          target_rpe: input.target_rpe,
          rest_seconds: input.rest_seconds,
        },
        { count: "exact" },
      )
      .eq("id", input.exerciseRowId),
  );
  if (failed) return failed;
  programTouched(input.programId);
  return { ok: true };
}

export async function removeProgramExercise(
  programId: string,
  exerciseRowId: string,
): Promise<ActionResult> {

  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_exercises").delete({ count: "exact" }).eq("id", exerciseRowId),
  );
  if (failed) return failed;
  programTouched(programId);
  return { ok: true };
}

/** Duplicate a day with all its targets — the build-once move from W4. */
export async function duplicateProgramDay(programId: string, dayId: string): Promise<ActionResult> {

  const supabase = await supabaseServer();
  const { data: source, error: readError } = await supabase
    .from("program_days")
    .select(
      "week_index, name, program_exercises(exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds, notes, circuit)",
    )
    .eq("id", dayId)
    .single();
  if (readError) return { ok: false, message: readError.message };

  const dayIndex = await nextDayIndex(supabase, programId, source.week_index);
  const { data: created, error: writeError } = await supabase
    .from("program_days")
    .insert({
      program_id: programId,
      week_index: source.week_index,
      day_index: dayIndex,
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

  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase
      .from("programs")
      .update({ status: "published" }, { count: "exact" })
      .eq("id", programId),
  );
  if (failed) return failed;
  revalidatePath(`/programs/${programId}`);
  revalidatePath("/programs");
  revalidatePath("/workout/build");
  revalidatePath("/workout");
  return { ok: true };
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


  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("programs")
    .insert({
      coach_id: null,
      client_id: userId,
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


  const supabase = await supabaseServer();
  const dayIndex = await nextDayIndex(supabase, programId, 1);
  const { error } = await supabase.from("program_days").insert({
    program_id: programId,
    week_index: 1,
    day_index: dayIndex,
    name: dayName,
    muscle_groups: muscleGroups,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/workout/build");
  return { ok: true };
}

/** The client's own draft-or-published program, if they have started one. */
export async function getMySoloProgramId(): Promise<string | null> {
  const live = await liveUser();
  if (!live) return null;
  const { supabase, userId } = live;
  const { data } = await supabase
    .from("programs")
    .select("id")
    .eq("client_id", userId)
    .is("coach_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Delete a training day and everything prescribed in it. The client reaches
 * this by swiping a day away on Training or in their builder and confirming.
 * program_exercises cascade in SQL. Deleting leaves a hole in day_index, which
 * is why the next day takes max(day_index) + 1 rather than a count.
 */
export async function removeProgramDay(programId: string, dayId: string): Promise<ActionResult> {

  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase
      .from("program_days")
      .delete({ count: "exact" })
      .eq("id", dayId)
      .eq("program_id", programId),
  );
  if (failed) return failed;
  revalidatePath(`/programs/${programId}`);
  revalidatePath("/workout/build");
  revalidatePath("/workout");
  return { ok: true };
}
