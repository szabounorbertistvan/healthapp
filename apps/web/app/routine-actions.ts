"use server";
// Writes for the routine library: copy, save, publish, describe, share.
//
// Every rule these actions look like they enforce is actually enforced in the
// database — copy_program() re-states the coach/solo guards, the
// program_saves policy's with-check refuses a bookmark on a program you cannot
// see, and programs_shareable_only_solo refuses a public coach program. What
// happens here is validation, translation of an error into something readable,
// and revalidatePath.
import { revalidatePath } from "next/cache";
import {
  canShareProgram,
  isPublishable,
  isRoutineGoal,
  isTrainingStyle,
  validateProgram,
  isRoutineLevel,
  isRoutineVisibility,
  snapshotProgram,
  type RoutineGoal,
  type RoutineLevel,
  type RoutineVisibility,
  type TrainingStyle,
} from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { notSignedIn } from "@/lib/action-result";
import { getRoutineDetail } from "@/lib/routine-data";
import { toProgramShape } from "@/lib/routine-shape";
import type { ActionResult } from "./actions";

/** Everything a routine change can touch. */
function routinesTouched(programId?: string) {
  revalidatePath("/routines");
  revalidatePath("/programs");
  revalidatePath("/workout");
  revalidatePath("/today");
  if (programId) {
    revalidatePath(`/routines/${programId}`);
    revalidatePath(`/programs/${programId}`);
  }
}

/**
 * Copy a routine. One action for all three buttons, because the database has
 * one function for them:
 *
 *   Duplicate            copyRoutine({ sourceId: mine })
 *   Copy to my programs  copyRoutine({ sourceId: someone's public one })
 *   Assign to a client   copyRoutine({ sourceId, forClientId })
 *
 * The copy is independent all the way down — new program, new days, new
 * prescribed exercises — so editing it never reaches back into the original.
 */
export async function copyRoutine(input: {
  sourceId: string;
  name?: string | null;
  /** A coach assigning to one of their active clients. */
  forClientId?: string | null;
}): Promise<ActionResult & { id?: string }> {
  const { t } = await getI18n();
  const r = t.clientApp.routines;
  const live = await liveUser();
  if (!live) return notSignedIn;

  const name = input.name?.trim().slice(0, 120) || null;
  const { data, error } = await live.supabase.rpc("copy_program", {
    p_source: input.sourceId,
    p_name: name,
    p_for_client: input.forClientId ?? null,
  });
  if (error) {
    // 42501 is the function refusing on a rule, not a broken query: a coached
    // client copying for themselves, or a coach writing for someone who is not
    // their client. Both deserve the explanation, not "something went wrong".
    if (error.code === "42501") {
      return { ok: false, message: input.forClientId ? error.message : r.cannotCopyCoached };
    }
    return { ok: false, message: r.couldNotCopy };
  }
  routinesTouched();
  return { ok: true, id: (data as string | null) ?? undefined, message: input.forClientId ? r.assigned : r.copied };
}

/**
 * Bookmark a routine, or remove the bookmark.
 *
 * The unique (user_id, program_id) pair is what makes this race-safe: two taps
 * arriving together cannot leave two rows, because the second insert violates
 * the constraint and is reported as already-saved rather than as a failure.
 * The same shape as follows and kudos.
 */
export async function toggleRoutineSave(programId: string, saved: boolean): Promise<ActionResult & { saved?: boolean }> {
  const { t } = await getI18n();
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  if (saved) {
    const { error } = await supabase
      .from("program_saves")
      .delete()
      .eq("user_id", userId)
      .eq("program_id", programId);
    if (error) return { ok: false, message: t.clientApp.routines.couldNotSave };
    routinesTouched(programId);
    return { ok: true, saved: false };
  }

  const { error } = await supabase.from("program_saves").insert({ user_id: userId, program_id: programId });
  if (error) {
    // Already there: the other tap won. That is the requested state, so it is
    // a success — not a duplicate to complain about.
    if (error.code === "23505") return { ok: true, saved: true };
    // 42501 here means the with-check refused: the program is not one this
    // person can see, so it is not one they may bookmark.
    return { ok: false, message: t.clientApp.routines.couldNotSave };
  }
  routinesTouched(programId);
  return { ok: true, saved: true };
}

/**
 * Rename a routine and set the metadata Discover filters on.
 *
 * `visibility` is accepted here too, but the constraint
 * programs_shareable_only_solo is what decides: a program with a coach cannot
 * leave private whatever this is called with.
 */
export async function updateRoutineDetails(input: {
  programId: string;
  name?: string;
  description?: string | null;
  level?: string | null;
  goal?: string | null;
  trainingStyle?: string | null;
  visibility?: string | null;
}): Promise<ActionResult> {
  const { t } = await getI18n();
  const r = t.clientApp.routines;
  const live = await liveUser();
  if (!live) return notSignedIn;

  const patch: Record<string, string | null> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) return { ok: false, message: r.nameRequired };
    patch.name = name.slice(0, 120);
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim().slice(0, 2000) || null;
  }
  if (input.level !== undefined) {
    patch.level = isRoutineLevel(input.level) ? (input.level as RoutineLevel) : null;
  }
  if (input.goal !== undefined) {
    patch.goal = isRoutineGoal(input.goal) ? (input.goal as RoutineGoal) : null;
  }
  if (input.trainingStyle !== undefined) {
    patch.training_style = isTrainingStyle(input.trainingStyle) ? (input.trainingStyle as TrainingStyle) : null;
  }
  if (input.visibility !== undefined && input.visibility !== null) {
    if (!isRoutineVisibility(input.visibility)) return { ok: false, message: "Unknown visibility" };
    patch.visibility = input.visibility as RoutineVisibility;
  }
  // Going PUBLIC is the one door validateProgram() guards: the shelf only
  // gains complete routines. Checked only on the change — a routine that is
  // already public (legacy, imperfect) keeps being public and editable.
  if (patch.visibility === "public") {
    const detail = await getRoutineDetail(input.programId);
    if (detail && detail.card.visibility !== "public" && !isPublishable(validateProgram(toProgramShape(detail)))) {
      return { ok: false, message: r.notPublishable };
    }
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const failed = await mutated(
    await live.supabase.from("programs").update(patch, { count: "exact" }).eq("id", input.programId),
  );
  if (failed) return failed;
  routinesTouched(input.programId);
  return { ok: true };
}

/**
 * Post a routine to the feed.
 *
 * The payload is a snapshot (snapshotProgram) for the reason every other post
 * type is: editing the routine tomorrow must not rewrite what was posted
 * today. It carries the plan — days, exercises, muscle groups — and nothing
 * anyone has logged.
 *
 * Only a public routine of your own can be posted, so the post never shows a
 * reader something they cannot then open.
 */
export async function shareRoutine(programId: string, visibility?: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const r = t.clientApp.routines;
  const live = await liveUser();
  if (!live) return notSignedIn;

  const detail = await getRoutineDetail(programId);
  if (!detail) return { ok: false, message: t.common.social.notFound };
  if (!canShareProgram(detail.card)) return { ok: false, message: r.couldNotShare };

  const payload = snapshotProgram(detail.card);
  const postVisibility = visibility === "followers" || visibility === "private" ? visibility : "public";
  const { error } = await live.supabase.from("social_posts").insert({
    user_id: live.userId,
    type: "program",
    text: null,
    payload,
    visibility: postVisibility,
  });
  if (error) {
    // The partial unique index on (user_id, payload->>'program_id'): this
    // routine is already on the feed, which is the state being asked for.
    if (error.code === "23505") return { ok: true };
    return { ok: false, message: r.couldNotShare };
  }
  revalidatePath("/feed");
  revalidatePath(`/routines/${programId}`);
  return { ok: true };
}

/**
 * Feature a routine on the Discover shelf and/or mark it as Voinic's. Admins
 * only: admin_set_program_flags() runs admin_assert(), and owners have no
 * column grant on either flag, so there is no other way to set them. Only a
 * public routine may carry them, and both drop the moment a non-admin edits the
 * routine or it leaves public (20260930150000) — they describe what was reviewed.
 */
export async function setRoutineFlags(programId: string, featured: boolean, official: boolean): Promise<ActionResult> {
  const { t } = await getI18n();
  const r = t.clientApp.routines;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("admin_set_program_flags", {
    p_program: programId,
    p_featured: featured,
    p_official: official,
  });
  if (error) {
    if (error.code === "22023") return { ok: false, message: r.flagsOnlyPublic };
    return { ok: false, message: r.couldNotFlag };
  }
  routinesTouched(programId);
  return { ok: true };
}
