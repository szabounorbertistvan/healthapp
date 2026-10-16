"use server";
// Achievements, the Fitness Score and who may see them. The number that is
// published is computed in the database, never taken from the browser.
import { revalidatePath } from "next/cache";
import {
  fitnessScorePostPayload, isBadgeSlug, isProfileVisibility,
} from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { currentActorId } from "@/lib/actor";
import { supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { insertPost, visibilityOf, type PostResult } from "@/lib/social-write";



// ---------- achievements and the Fitness Score ----------

/**
 * Share a badge you have earned. The browser names the badge and nothing else:
 * social_posts_guard refuses a badge that is not in user_badges for you and
 * rebuilds the payload from the catalog, so the snapshot is the server's.
 */
export async function shareAchievement(slug: string, visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  if (!isBadgeSlug(slug)) return { ok: false, message: t.common.social.notFound };
  const result = await insertPost({
    type: "achievement",
    text: null,
    payload: { kind: "achievement", badge_slug: slug },
    visibility: visibilityOf(visibility),
  });
  // 42501 from the guard: not earned. Say "not found" rather than echo the database.
  if (!result.ok && result.message?.includes("badge not earned")) return { ok: false, message: t.common.social.notFound };
  return result;
}



/**
 * The score as the server computes it now — never a number the browser sends.
 * Null while the score is still building.
 */
async function currentScore(): Promise<{ score: number; band: string | null } | null> {
  const view = await getMyFitnessScore();
  const current = view?.current;
  if (!current || current.status !== "active" || current.score === null) return null;
  return { score: current.score, band: current.band };
}



/**
 * Share the Fitness Score milestone you have reached — once per milestone.
 *
 * The score computed here only decides whether there is anything to share and
 * gives a friendly error if not. The number that is published is not this
 * one: social_posts_guard replaces the payload with fitness_score_of() — the
 * same formula, run by the database — so neither this action nor a hand-made
 * PostgREST insert can put a score into the feed that the sessions do not back.
 */
export async function shareFitnessScore(visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const now = await currentScore();
  const payload = now ? fitnessScorePostPayload(now.score, now.band) : null;
  if (!payload) return { ok: false, message: t.common.social.scoreNotReady };
  const result = await insertPost({ type: "fitness_score", text: null, payload, visibility: visibilityOf(visibility) });
  // 22023 from the guard: the database's own count says still building.
  if (!result.ok && result.message?.includes("still building")) return { ok: false, message: t.common.social.scoreNotReady };
  revalidatePath("/fitness-score");
  return result;
}



/**
 * Put your current score on your profile. set_public_fitness_score() takes no
 * argument: the database computes the caller's own score (fitness_score_of,
 * the mirrored formula) and stores that number and the time. There is nothing
 * this action — or anyone calling the RPC directly — could send to change it.
 */
export async function publishFitnessScore(): Promise<ActionResult & { score?: number }> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_public_fitness_score");
  // 22023: still building (fewer than three workouts in 28 days).
  if (error) return { ok: false, message: error.code === "22023" ? t.common.social.scoreNotReady : error.message };
  revalidatePath(`/people/${uid}`);
  revalidatePath("/account");
  revalidatePath("/settings");
  return { ok: true, score: typeof data === "number" ? data : undefined };
}



/** Who sees your activity stats and your published Fitness Score. */
export async function updateSocialPrivacy(input: { stats: string; fitnessScore: string }): Promise<ActionResult> {
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (!isProfileVisibility(input.stats) || !isProfileVisibility(input.fitnessScore)) {
    return { ok: false, message: "Unknown visibility" };
  }
  const supabase = await supabaseServer();
  const failure = await mutated(
    await supabase
      .from("users")
      .update({ stats_visibility: input.stats, fitness_score_visibility: input.fitnessScore }, { count: "exact" })
      .eq("id", uid),
  );
  if (failure) return failure;
  revalidatePath(`/people/${uid}`);
  revalidatePath("/account");
  revalidatePath("/settings");
  return { ok: true };
}
