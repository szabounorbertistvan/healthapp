"use server";
// Follow and unfollow. Both are idempotent: a retry leaves the same edge.
import { validateFollow } from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { currentActorId } from "@/lib/actor";
import { supabaseServer } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { touched } from "@/lib/social-write";



// ---------- follows ----------

/**
 * Follow someone. Idempotent: the upsert ignores the unique pair, so a double
 * tap or a retry leaves one edge, and the new_follower trigger only ever
 * writes one notification per pair. Yourself is refused here, and again by
 * the check constraint on social_follows.
 */
export async function follow(targetId: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (validateFollow(uid, targetId, new Set()) === "self") return { ok: false, message: t.common.social.cannotFollowSelf };
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("social_follows")
    .upsert({ follower_id: uid, following_id: targetId }, { onConflict: "follower_id,following_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: error.message };
  touched();
  return { ok: true };
}



/**
 * Stop following someone. Idempotent on purpose, unlike the other writes that
 * go through mutated(): the delete is filtered to the caller's own edge, so
 * zero rows can only mean "already not following" — a second tap or a retry
 * racing the first — which is the state that was asked for, not a failure.
 */
export async function unfollow(targetId: string): Promise<ActionResult> {
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const supabase = await supabaseServer();
  const { error } = await supabase.from("social_follows").delete().eq("follower_id", uid).eq("following_id", targetId);
  if (error) return { ok: false, message: error.message };
  touched();
  return { ok: true };
}
