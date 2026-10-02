"use server";
import { revalidatePath } from "next/cache";
import { DEFAULT_TARGETS, isExerciseMeasure, isPlanLimitError, isSetType, swapNeighbour, validateTargets, type ExerciseTargets } from "@healthapp/shared";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import type { ActionResult } from "./actions";
import { notSignedIn, planLimitReached, upgradeRequired } from "@/lib/action-result";
import { getPlan } from "@/lib/plan";
import { z } from "zod";
import { num, id, intensityMode, parseInput, step, text } from "@/lib/validate";

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
//
// Every export parses its arguments first (lib/validate.ts): these are public
// endpoints, and the TypeScript signature only binds our own screens.

/** The prescription's shape; its ranges are validateTargets(), checked after the parse. */
const targetsShape = z.object({
  target_sets: num,
  target_reps: text(15),
  target_weight_kg: num.nullable(),
  target_rpe: num.nullable(),
  rest_seconds: num.nullable(),
});

// An empty clientId / exerciseId is let through on purpose: the action answers
// it with "Pick a client" / "Pick an exercise".
const CreateProgramInput = z.object({
  name: text(),
  clientId: id.or(z.literal("")),
  clientName: text(),
  weeks: z.number().int().min(1).max(52),
  intensityMode,
});

const AddExerciseInput = z.object({
  programId: id,
  dayId: id,
  exerciseId: id,
  exerciseName: text(),
  targets: targetsShape.partial().optional(),
  circuit: num.nullable().optional(),
});

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
  const parsed = await parseInput(CreateProgramInput, input);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.tuple([id, text()]), [programId, name]);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(AddExerciseInput, input);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.tuple([id, id, text()]), [programId, dayId, name]);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.tuple([id, id, step]), [programId, dayId, direction]);
  if (!parsed.ok) return parsed.result;
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("move_program_day", { p_day: dayId, p_direction: direction });
  if (error) return { ok: false, message: error.code === "42501" ? "You cannot edit this program" : error.message };
  programTouched(programId);
  return { ok: true };
}

/** Move an exercise one step up or down inside its day (swap with its neighbour). */
export async function moveProgramExercise(programId: string, dayId: string, rowId: string, direction: -1 | 1): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id, id, step]), [programId, dayId, rowId, direction]);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.tuple([id, id, num.nullable()]), [programId, rowId, circuit]);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.tuple([id, id, id.or(z.literal(""))]), [programId, rowId, exerciseId]);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(targetsShape.extend({ programId: id, exerciseRowId: id }), input);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.tuple([id, id]), [programId, exerciseRowId]);
  if (!parsed.ok) return parsed.result;
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_exercises").delete({ count: "exact" }).eq("id", exerciseRowId),
  );
  if (failed) return failed;
  programTouched(programId);
  return { ok: true };
}

/** How the prescribed sets are performed (normal, warm-up, drop set, AMRAP, to failure). */
export async function setProgramExerciseSetType(
  programId: string,
  exerciseRowId: string,
  setType: string,
): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id, text(20)]), [programId, exerciseRowId, setType]);
  if (!parsed.ok) return parsed.result;
  if (!isSetType(setType)) return { ok: false, message: "Unknown set type" };
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_exercises").update({ set_type: setType }, { count: "exact" }).eq("id", exerciseRowId),
  );
  if (failed) return failed;
  programTouched(programId);
  return { ok: true };
}

/**
 * Count an exercise by reps or by time. A timed row keeps target_reps as it
 * is and reads it as seconds, so switching never loses what the coach typed.
 */
export async function setProgramExerciseMeasure(
  programId: string,
  exerciseRowId: string,
  measure: string,
): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id, text(10)]), [programId, exerciseRowId, measure]);
  if (!parsed.ok) return parsed.result;
  if (!isExerciseMeasure(measure)) return { ok: false, message: "Unknown measure" };
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_exercises").update({ measure }, { count: "exact" }).eq("id", exerciseRowId),
  );
  if (failed) return failed;
  programTouched(programId);
  return { ok: true };
}

/** Longest coach cue on one exercise; a paragraph, not an essay. */
const MAX_EXERCISE_NOTE = 1000;

/**
 * The coach's own cue for this exercise in this program — tempo, setup, what
 * to feel — shown to the client beside it. Blank clears it.
 */
export async function setProgramExerciseNotes(
  programId: string,
  exerciseRowId: string,
  notes: string,
): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id, z.string().max(MAX_EXERCISE_NOTE * 2)]), [programId, exerciseRowId, notes]);
  if (!parsed.ok) return parsed.result;
  const value = notes.trim().slice(0, MAX_EXERCISE_NOTE) || null;
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("program_exercises").update({ notes: value }, { count: "exact" }).eq("id", exerciseRowId),
  );
  if (failed) return failed;
  programTouched(programId);
  return { ok: true };
}

/**
 * Copy one prescribed exercise to right after itself — targets, circuit and
 * set type included. duplicate_program_exercise() shifts the rows below and
 * inserts in one transaction, under the editing policies, and refuses anyone
 * who may not edit the program (a coached client, a stranger).
 */
export async function duplicateProgramExercise(programId: string, exerciseRowId: string): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id]), [programId, exerciseRowId]);
  if (!parsed.ok) return parsed.result;
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("duplicate_program_exercise", { p_row: exerciseRowId });
  if (error) return { ok: false, message: error.message };
  programTouched(programId);
  return { ok: true };
}

/** Duplicate a day with all its targets — the build-once move from W4. Coach Pro. */
export async function duplicateProgramDay(programId: string, dayId: string): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id]), [programId, dayId]);
  if (!parsed.ok) return parsed.result;
  if (!(await getPlan()).e.programCopy) return upgradeRequired;

  const supabase = await supabaseServer();
  const { data: source, error: readError } = await supabase
    .from("program_days")
    .select(
      "week_index, name, muscle_groups, program_exercises(exercise_id, position, target_sets, target_reps, target_weight_kg, target_rpe, rest_seconds, notes, circuit, set_type, measure)",
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
      muscle_groups: source.muscle_groups ?? [],
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

/**
 * Copy a whole program — every day and every exercise with its targets — to
 * another of the coach's clients, as a draft the coach then adjusts and
 * publishes. Coach Pro.
 *
 * The same copy_program() behind Duplicate, "Copy to my programs" and Assign
 * on the routine page: one atomic function, so a failure halfway can no longer
 * leave a half-copied program, and the copy keeps description, level, goal,
 * style, supersets, set types and its lineage. The function re-checks that the
 * caller actively coaches this client and can see the source.
 */
export async function copyProgramToClient(
  programId: string,
  clientId: string,
): Promise<ActionResult & { id?: string }> {
  const parsed = await parseInput(z.tuple([id, id]), [programId, clientId]);
  if (!parsed.ok) return parsed.result;
  if (!(await getPlan()).e.programCopy) return upgradeRequired;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("copy_program", {
    p_source: programId,
    p_name: null,
    p_for_client: clientId,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/programs");
  return { ok: true, id: (data as string | null) ?? undefined };
}

/** Publish makes the program visible to the client and fires Plan updated. */
export async function publishProgram(programId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, programId);
  if (!parsed.ok) return parsed.result;
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
  const parsed = await parseInput(z.object({ name: text(), intensityMode }), input);
  if (!parsed.ok) return parsed.result;
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
  // enforce_plan_limit('own_programs') refuses a program past the plan's cap.
  if (isPlanLimitError(error?.message)) return planLimitReached;
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
  const parsed = await parseInput(z.tuple([id, text(), z.array(text(40)).max(30)]), [programId, name, muscleGroups]);
  if (!parsed.ok) return parsed.result;
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

/**
 * Every program the client built for themselves, newest first.
 *
 * This used to be a single id, which quietly meant a solo client could own
 * exactly one program for ever: the builder only ever opened the most recently
 * touched row, so creating a second one made the first unreachable. Someone
 * training on their own needs a block per goal — a push/pull split beside a
 * deload week — and nothing in the schema ever stopped that.
 */
export async function getMySoloPrograms(): Promise<
  { id: string; name: string; status: string; days: number; updated_at: string }[]
> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("programs")
    .select("id, name, status, updated_at, program_days(id)")
    .eq("client_id", userId)
    .is("coach_id", null)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("solo programs read failed:", error.message);
    return [];
  }
  type Row = { id: string; name: string; status: string; updated_at: string; program_days: { id: string }[] };
  return ((data ?? []) as Row[]).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    days: p.program_days?.length ?? 0,
    updated_at: p.updated_at,
  }));
}

/** The client's most recently touched own program, if they have started one. */
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
  const parsed = await parseInput(z.tuple([id, id]), [programId, dayId]);
  if (!parsed.ok) return parsed.result;
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

/**
 * Delete a whole program.
 *
 * Which rows go is decided by the schema, not here: `program_days` and
 * `program_exercises` cascade, while `logged_sessions.program_day_id` and
 * `logged_sets.program_exercise_id` are `on delete set null`. So the training
 * history survives intact — every set, its weight, its PR flag — and only the
 * link back to the plan is cut. A past session then reads as "Session" rather
 * than "Upper A" (`client-training.ts`, `day_name`), which is why the button
 * confirms before it fires.
 *
 * No coach/owner check here: `programs_coach_all` (coach_id = auth.uid()) and
 * `programs_solo_delete` are the gate, and `mutated()` turns an RLS-filtered
 * zero-row delete into a visible error instead of a false success.
 */
export async function deleteProgram(programId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, programId);
  if (!parsed.ok) return parsed.result;
  const supabase = await supabaseServer();
  const failed = await mutated(
    await supabase.from("programs").delete({ count: "exact" }).eq("id", programId),
  );
  if (failed) return failed;
  revalidatePath("/programs");
  revalidatePath("/workout");
  revalidatePath("/workout/build");
  revalidatePath("/today");
  return { ok: true };
}
