"use server";
import { revalidatePath } from "next/cache";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

// Program builder writes (W4, Sprint 3).
//
// Status of the Supabase branch (docs/superpowers/specs/2026-09-08-s1-*):
// written to the schema and reviewed against the RLS policies, not yet driven
// end-to-end against a live project. Every update/delete goes through
// `mutated()` so an RLS-filtered write cannot report success.
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

export async function addProgramExercise(input: {
  programId: string;
  dayId: string;
  exerciseId: string;
  exerciseName: string;
}): Promise<ActionResult> {

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
  revalidatePath("/workout/build");
  revalidatePath("/workout");
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
  revalidatePath(`/programs/${input.programId}`);
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
  revalidatePath(`/programs/${programId}`);
  return { ok: true };
}

/** Duplicate a day with all its targets — the build-once move from W4. */
export async function duplicateProgramDay(programId: string, dayId: string): Promise<ActionResult> {

  const supabase = await supabaseServer();
  const { data: source, error: readError } = await supabase
    .from("program_days")
    .select(
      "week_index, name, program_exercises(exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds, notes)",
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
