"use server";
// Social feed writes. Each one writes only as the signed-in user (RLS
// re-checks that), and every post that comes from data is a SNAPSHOT built
// here from rows the user owns — the feed never reads their logs later.
import { revalidatePath } from "next/cache";
import {
  POST_VISIBILITIES,
  STREAK_SHARE_MIN,
  canKudos,
  payloadIsSafe,
  validateComment,
  validateFollow,
  validatePostText,
  workoutPostPayload,
  type ChallengePostPayload,
  type PostPayload,
  type PostType,
  type PostVisibility,
  type PrPostPayload,
  type ProgressPostPayload,
  type StreakPostPayload,
} from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { viewingClientId } from "@/lib/view-mode";
import { clientStore, newId } from "@/lib/demo-client-store";
import { getPostKudos, getShareableSession } from "@/lib/social-data";
import { getChallenge } from "@/lib/challenges-data";
import { getMyStreak } from "@/lib/streak-data";
import type { KudosPage } from "@/lib/types";
import type { ActionResult } from "./actions";

export type PostResult = ActionResult & { postId?: string };

function touched(extra: string[] = []) {
  revalidatePath("/feed");
  revalidatePath("/people", "layout");
  for (const p of extra) revalidatePath(p);
}

async function userId(): Promise<string | null> {
  if (isDemo) return viewingClientId();
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  return auth.user?.id ?? null;
}

function visibilityOf(input: string | undefined): PostVisibility {
  return (POST_VISIBILITIES as readonly string[]).includes(input ?? "") ? (input as PostVisibility) : "followers";
}

// ---------- follows ----------

export async function follow(targetId: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await userId();
  if (!uid) return { ok: false, message: "Not signed in" };
  if (isDemo) {
    const cs = clientStore();
    const existing = new Set(cs.follows.filter((f) => f.follower_id === uid).map((f) => f.following_id));
    const err = validateFollow(uid, targetId, existing);
    if (err === "self") return { ok: false, message: t.common.social.cannotFollowSelf };
    if (err === null) cs.follows.push({ id: newId("fo"), follower_id: uid, following_id: targetId, created_at: new Date().toISOString() });
    touched();
    return { ok: true, demo: true };
  }
  if (uid === targetId) return { ok: false, message: t.common.social.cannotFollowSelf };
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("social_follows")
    .upsert({ follower_id: uid, following_id: targetId }, { onConflict: "follower_id,following_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: error.message };
  touched();
  return { ok: true };
}

export async function unfollow(targetId: string): Promise<ActionResult> {
  const uid = await userId();
  if (!uid) return { ok: false, message: "Not signed in" };
  if (isDemo) {
    const cs = clientStore();
    const i = cs.follows.findIndex((f) => f.follower_id === uid && f.following_id === targetId);
    if (i >= 0) cs.follows.splice(i, 1);
    touched();
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const result = await supabase.from("social_follows").delete({ count: "exact" }).eq("follower_id", uid).eq("following_id", targetId);
  const failure = await mutated(result);
  if (failure) return failure;
  touched();
  return { ok: true };
}

// ---------- posts ----------

async function insertPost(input: {
  type: PostType;
  text: string | null;
  payload: PostPayload;
  visibility: PostVisibility;
  activity_id?: string | null;
  challenge_id?: string | null;
}): Promise<PostResult> {
  const uid = await userId();
  if (!uid) return { ok: false, message: "Not signed in" };
  if (!payloadIsSafe(input.payload)) return { ok: false, message: "Payload carries private data" };
  if (isDemo) {
    const cs = clientStore();
    // Mirror the partial unique indexes: one workout post per session, one
    // completion per challenge, one post per streak milestone.
    const streak = input.payload?.kind === "streak" ? input.payload : null;
    const dup = cs.posts.find(
      (p) =>
        p.user_id === uid && p.deleted_at === null &&
        ((input.type === "workout" && input.activity_id && p.type === "workout" && p.activity_id === input.activity_id) ||
          (input.type === "challenge_completed" && input.challenge_id && p.type === "challenge_completed" && p.challenge_id === input.challenge_id) ||
          (streak !== null && p.type === "streak" && p.payload?.kind === "streak" &&
            p.payload.milestone === streak.milestone && p.payload.streak_start === streak.streak_start)),
    );
    if (dup) return { ok: true, demo: true, postId: dup.id };
    const id = newId("po");
    cs.posts.push({
      id, user_id: uid, type: input.type, text: input.text, payload: input.payload, visibility: input.visibility,
      activity_id: input.activity_id ?? null, challenge_id: input.challenge_id ?? null,
      created_at: new Date().toISOString(), deleted_at: null,
    });
    touched();
    return { ok: true, demo: true, postId: id };
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("social_posts")
    .insert({
      user_id: uid, type: input.type, text: input.text, payload: input.payload, visibility: input.visibility,
      activity_id: input.activity_id ?? null, challenge_id: input.challenge_id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = the partial unique index: already shared. Treat as success.
    if (error.code === "23505") return { ok: true };
    return { ok: false, message: error.message };
  }
  touched();
  return { ok: true, postId: data.id };
}

export async function createTextPost(text: string, visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const clean = validatePostText(text);
  if (!clean) return { ok: false, message: t.common.social.textInvalid };
  return insertPost({ type: "text", text: clean, payload: null, visibility: visibilityOf(visibility) });
}

/** A progress post: text, optionally the weight the author typed in. Never read from measurements. */
export async function createProgressPost(text: string, visibility?: string, weightKg?: number | null): Promise<PostResult> {
  const { t } = await getI18n();
  const clean = validatePostText(text);
  if (!clean) return { ok: false, message: t.common.social.textInvalid };
  const payload: ProgressPostPayload = { kind: "progress", photo_path: null };
  if (typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0) payload.weight_kg = Math.round(weightKg * 10) / 10;
  return insertPost({ type: "progress", text: clean, payload, visibility: visibilityOf(visibility) });
}

/** Share a finished session: the aggregates only, snapshotted now. */
export async function shareWorkout(sessionId: string, visibility?: string, text?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const s = await getShareableSession(sessionId);
  if (!s) return { ok: false, message: t.common.social.notFound };
  const caption = text ? validatePostText(text) : null;
  return insertPost({
    type: "workout",
    text: caption,
    payload: workoutPostPayload({ name: s.name, date: s.date, duration_min: s.duration_min, exercises: s.exercises, sets: s.sets, volume_kg: s.volume_kg, load: s.load, prs: s.prs.length }),
    visibility: visibilityOf(visibility),
    activity_id: sessionId,
  });
}

/** Share one PR the PR engine flagged in a session. */
export async function sharePr(sessionId: string, setId: string, visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const s = await getShareableSession(sessionId);
  const pr = s?.prs.find((p) => p.set_id === setId);
  if (!s || !pr) return { ok: false, message: t.common.social.notFound };
  if (pr.shared) return { ok: true };
  const payload: PrPostPayload = { kind: "pr", exercise: pr.exercise, weight_kg: pr.weight_kg, reps: pr.reps, estimated_1rm: pr.estimated_1rm, date: s.date };
  return insertPost({ type: "pr", text: null, payload, visibility: visibilityOf(visibility), activity_id: sessionId });
}

/** Share a completed challenge — once; the partial unique index dedupes repeat visits. */
export async function shareChallenge(challengeId: string, visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const c = await getChallenge(challengeId);
  if (!c || !c.joined || c.status !== "completed") return { ok: false, message: t.common.social.notFound };
  const payload: ChallengePostPayload = { kind: "challenge_completed", title_en: c.title, title_ro: c.title, type: c.type, target: c.target, value: c.progress };
  const result = await insertPost({ type: "challenge_completed", text: null, payload, visibility: visibilityOf(visibility), challenge_id: challengeId });
  revalidatePath(`/challenges/${challengeId}`);
  return result;
}

/**
 * Share a streak milestone — once per (milestone, streak_start). The numbers
 * come from the server's own read of the user's sessions; the client only
 * names which reached milestone it means, never how long the streak is.
 */
export async function shareStreak(milestone: number, streakStart: string, visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const view = await getMyStreak();
  const reached = view?.milestones.find((m) => m.milestone === milestone && m.streak_start === streakStart);
  if (!reached || reached.milestone < STREAK_SHARE_MIN) return { ok: false, message: t.common.social.notFound };
  if (reached.shared) return { ok: true };
  const payload: StreakPostPayload = {
    kind: "streak",
    streak_days: reached.milestone,
    milestone: reached.milestone,
    achieved_at: reached.reached_on,
    streak_start: reached.streak_start,
    title: `${reached.milestone} Day Streak`,
  };
  const result = await insertPost({ type: "streak", text: null, payload, visibility: visibilityOf(visibility) });
  revalidatePath("/streak");
  revalidatePath("/today");
  return result;
}

export async function deletePost(postId: string): Promise<ActionResult> {
  const uid = await userId();
  if (!uid) return { ok: false, message: "Not signed in" };
  if (isDemo) {
    const p = clientStore().posts.find((x) => x.id === postId && x.user_id === uid);
    if (p) p.deleted_at = new Date().toISOString();
    touched();
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const result = await supabase
    .from("social_posts")
    .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", postId)
    .eq("user_id", uid)
    .is("deleted_at", null);
  const failure = await mutated(result);
  if (failure) return failure;
  touched();
  return { ok: true };
}

// ---------- kudos ----------

export type KudosResult = ActionResult & { kudos?: boolean };

/**
 * Give kudos, or take it back if already given. `kudos` in the result is the
 * state the row is in afterwards, so the card can settle on the truth when
 * two taps race. The giver is always the signed-in user; the post must be
 * visible to them and not their own (canKudos here, can_kudos_post in RLS).
 */
export async function toggleKudos(postId: string): Promise<KudosResult> {
  const { t } = await getI18n();
  const uid = await userId();
  if (!uid) return { ok: false, message: "Not signed in" };
  if (isDemo) {
    const cs = clientStore();
    const post = cs.posts.find((p) => p.id === postId);
    const follows = new Set(cs.follows.filter((f) => f.follower_id === uid).map((f) => f.following_id));
    const err = post ? canKudos(post, uid, follows) : "not_visible";
    if (err === "self") return { ok: false, message: t.common.social.cannotKudosSelf };
    if (err !== null) return { ok: false, message: t.common.social.postNotFound };
    const i = cs.reactions.findIndex((r) => r.post_id === postId && r.user_id === uid);
    if (i >= 0) cs.reactions.splice(i, 1);
    else cs.reactions.push({ id: newId("re"), post_id: postId, user_id: uid, type: "kudos", created_at: new Date().toISOString() });
    touched([`/feed/${postId}`]);
    return { ok: true, demo: true, kudos: i < 0 };
  }
  const supabase = await supabaseServer();
  // posts_select is can_see_post(): a post the user may not see (or a deleted one) reads as absent.
  const { data: post } = await supabase.from("social_posts").select("user_id").eq("id", postId).maybeSingle();
  if (!post) return { ok: false, message: t.common.social.postNotFound };
  if (post.user_id === uid) return { ok: false, message: t.common.social.cannotKudosSelf };

  const { data: existing } = await supabase.from("social_reactions").select("id").eq("post_id", postId).eq("user_id", uid).eq("type", "kudos").maybeSingle();
  if (existing) {
    // A zero-row delete means another tap already removed it — the end state is the same.
    const { error } = await supabase.from("social_reactions").delete().eq("id", existing.id).eq("user_id", uid);
    if (error) return { ok: false, message: error.message };
    touched([`/feed/${postId}`]);
    return { ok: true, kudos: false };
  }
  const { error } = await supabase.from("social_reactions").insert({ post_id: postId, user_id: uid, type: "kudos" });
  if (error && error.code !== "23505") {
    // 42501 = RLS refused it (visibility changed or self-kudos); anything else is a real failure.
    return { ok: false, message: error.code === "42501" ? t.common.social.postNotFound : error.message };
  }
  // 23505 = the unique (post_id, user_id, type): a racing tap already gave it. Same end state.
  touched([`/feed/${postId}`]);
  return { ok: true, kudos: true };
}

/** One page of who gave kudos, for the list behind the count. A read, but on demand from the card. */
export async function loadKudos(postId: string, before: string | null = null): Promise<KudosPage> {
  return getPostKudos(postId, before);
}

// ---------- comments ----------

export async function addComment(postId: string, body: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await userId();
  if (!uid) return { ok: false, message: "Not signed in" };
  const clean = validateComment(body);
  if (!clean) return { ok: false, message: t.common.social.commentInvalid };
  if (isDemo) {
    clientStore().comments.push({ id: newId("co"), post_id: postId, user_id: uid, body: clean, created_at: new Date().toISOString() });
    touched([`/feed/${postId}`]);
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.from("social_comments").insert({ post_id: postId, user_id: uid, body: clean });
  if (error) return { ok: false, message: error.message };
  touched([`/feed/${postId}`]);
  return { ok: true };
}

export async function deleteComment(commentId: string, postId: string): Promise<ActionResult> {
  const uid = await userId();
  if (!uid) return { ok: false, message: "Not signed in" };
  if (isDemo) {
    const cs = clientStore();
    const i = cs.comments.findIndex((c) => c.id === commentId && c.user_id === uid);
    if (i >= 0) cs.comments.splice(i, 1);
    touched([`/feed/${postId}`]);
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const result = await supabase.from("social_comments").delete({ count: "exact" }).eq("id", commentId).eq("user_id", uid);
  const failure = await mutated(result);
  if (failure) return failure;
  touched([`/feed/${postId}`]);
  return { ok: true };
}
