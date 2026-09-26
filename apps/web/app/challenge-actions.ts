"use server";
// Join, leave, create and delete a challenge. Progress, milestones and
// completion are never written here — the database computes and stamps them
// (challenge_cards / challenge_sync, 20261001100000); participants have no
// UPDATE on their own row at all.
import { revalidatePath } from "next/cache";
import { isChallengeDifficulty, isChallengeType, requiresExercise } from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function touched(id: string) {
  revalidatePath("/challenges");
  revalidatePath(`/challenges/${id}`);
  revalidatePath("/today");
}

export async function joinChallenge(id: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { data: ch } = await supabase.from("challenges").select("id").eq("id", id).maybeSingle();
  if (!ch) return { ok: false, message: t.common.challenges.notFound };
  // participants_join decides "has it ended?" on the member's own calendar
  // (my_local_today); its refusal is translated rather than pre-checked here
  // against the server's clock, which may be a day off.
  const { error } = await supabase
    .from("challenge_participants")
    .upsert({ challenge_id: id, user_id: userId }, { onConflict: "challenge_id,user_id", ignoreDuplicates: true });
  if (error) {
    return { ok: false, message: error.code === "42501" ? t.common.challenges.endedCannotJoin : error.message };
  }
  touched(id);
  return { ok: true };
}

export async function leaveChallenge(id: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const result = await supabase
    .from("challenge_participants")
    .delete({ count: "exact" })
    .eq("challenge_id", id)
    .eq("user_id", userId);
  const failure = await mutated(result);
  if (failure) return failure;
  touched(id);
  return { ok: true };
}

/**
 * A challenge of your own — "300 km this month with the people I train with".
 *
 * The schema and its policies have supported this since the challenges
 * migration (`creator_id`, `visibility`, `challenges_owner_insert`); only the
 * app never offered it, so the four platform-seeded challenges were all anyone
 * could ever join. Nothing here is new permission, just the missing form.
 *
 * Progress is still derived at read time from logged sessions, so a creator
 * cannot inflate anyone's numbers — including their own.
 */
export async function createChallenge(input: {
  name: string;
  description?: string;
  type: string;
  targetValue: number;
  startDate: string;
  endDate: string;
  visibility: "public" | "private";
  difficulty?: string | null;
  /** Required for exercise_sessions / strength_gain, refused for every other type. */
  exerciseId?: string | null;
}): Promise<ActionResult & { id?: string }> {
  const { t } = await getI18n();
  const name = input.name.trim();
  if (name.length < 3) return { ok: false, message: t.common.challenges.nameTooShort };
  if (!isChallengeType(input.type)) return { ok: false, message: t.common.challenges.unknownType };
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0) {
    return { ok: false, message: t.common.challenges.targetTooSmall };
  }
  // A window that ends before it starts would pass the check constraint only by
  // accident of ordering; catching it here gives a translated reason.
  if (input.endDate < input.startDate) return { ok: false, message: t.common.challenges.badWindow };
  if (requiresExercise(input.type) && !UUID.test(input.exerciseId ?? "")) {
    return { ok: false, message: t.common.challenges.exerciseMissing };
  }
  if (input.difficulty && !isChallengeDifficulty(input.difficulty)) {
    return { ok: false, message: t.common.challenges.unknownDifficulty };
  }

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  const { data, error } = await supabase
    .from("challenges")
    .insert({
      // The columns are title_*; this action wrote name_* and so never
      // created a challenge at all.
      title_en: name,
      title_ro: name,
      description_en: input.description?.trim() || null,
      description_ro: input.description?.trim() || null,
      type: input.type,
      target_value: input.targetValue,
      start_date: input.startDate,
      end_date: input.endDate,
      creator_id: userId,
      visibility: input.visibility,
      difficulty: input.difficulty || null,
      exercise_id: requiresExercise(input.type) ? input.exerciseId : null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  // The creator joins their own challenge: a private one nobody has joined is
  // invisible even to its author on the next read, because can_see_challenge
  // resolves private through participation.
  await supabase
    .from("challenge_participants")
    .upsert({ challenge_id: data.id, user_id: userId }, { onConflict: "challenge_id,user_id", ignoreDuplicates: true });

  touched(data.id);
  return { ok: true, id: data.id };
}

/** Delete a challenge you created. Policy challenges_owner_delete does the guarding. */
export async function deleteChallenge(id: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const failed = await mutated(
    await supabase.from("challenges").delete({ count: "exact" }).eq("id", id).eq("creator_id", userId),
  );
  if (failed) return failed;
  touched(id);
  return { ok: true };
}
