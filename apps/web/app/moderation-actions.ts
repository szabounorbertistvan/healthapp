"use server";
// Mute, block and report. None of them notifies anyone. Block and report go
// through security-definer RPCs that take the actor from the session
// (social_block_user removes the follows in the same transaction; social_report
// re-validates everything); mute is a plain row under RLS.
import { revalidatePath } from "next/cache";
import { isPostId, validateReport, type ReportTarget } from "@healthapp/shared";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { currentActorId } from "@/lib/actor";
import { getI18n } from "@/lib/i18n/server";
import { supabaseServer } from "@/lib/supabase/server";

function touched() {
  revalidatePath("/feed");
  revalidatePath("/saved");
  revalidatePath("/people", "layout");
}

/** Mute or unmute — the state asked for, idempotent both ways. */
export async function setMuted(userId: string, mute: boolean): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (!isPostId(userId) || userId === uid) return { ok: false, message: t.common.moderation.failed };
  const supabase = await supabaseServer();
  const { error } = mute
    ? await supabase
        .from("social_user_mutes")
        .upsert({ muter_id: uid, muted_id: userId }, { onConflict: "muter_id,muted_id", ignoreDuplicates: true })
    : await supabase.from("social_user_mutes").delete().eq("muter_id", uid).eq("muted_id", userId);
  if (error) return { ok: false, message: t.common.moderation.failed };
  touched();
  return { ok: true };
}

/** Block (and end the follows between you, atomically) or unblock (follows stay ended). */
export async function setBlocked(userId: string, block: boolean): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (!isPostId(userId) || userId === uid) return { ok: false, message: t.common.moderation.failed };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(block ? "social_block_user" : "social_unblock_user", { p_user: userId });
  if (error) return { ok: false, message: t.common.moderation.failed };
  touched();
  return { ok: true };
}

/**
 * Report a post, a comment, a person or a coach review. For a comment only its id travels —
 * the post it belongs to is read in the database, never sent from here. The reporter is the session's, never sent; the
 * reason must be one of the list. A post that is gone or hidden answers the
 * same as a failure, so the result says nothing about what exists.
 */
export async function reportContent(kind: ReportTarget, targetId: string, reason: string, details: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const m = t.common.moderation;
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if ((kind !== "post" && kind !== "comment" && kind !== "user" && kind !== "review") || !isPostId(targetId)) return { ok: false, message: m.failed };
  const valid = validateReport({ reason, details });
  if (!valid.ok) return { ok: false, message: valid.error === "details" ? m.detailsTooLong : m.failed };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("social_report", {
    p_kind: kind, p_target: targetId, p_reason: valid.reason, p_details: valid.details,
  });
  if (error) return { ok: false, message: m.failed };
  return { ok: true };
}
