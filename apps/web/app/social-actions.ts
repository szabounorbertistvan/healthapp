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
  extractMentionHandles,
  resolveMentions,
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
import { CloudinaryNotConfiguredError, cloudinaryConfigured, postPhotoFolder, postPhotoUrl, signPostPhotoUpload, type PostPhotoUploadTicket } from "@/lib/cloudinary";
import { currentActorId } from "@/lib/actor";
import { supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { getComments, getMentionCandidates, getPostKudos, getShareableSession } from "@/lib/social-data";
import { getChallenge } from "@/lib/challenges-data";
import { getMyStreak } from "@/lib/streak-data";
import type { CommentPage, KudosPage, PersonRow } from "@/lib/types";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

export type PostResult = ActionResult & { postId?: string };

function touched(extra: string[] = []) {
  revalidatePath("/feed");
  revalidatePath("/people", "layout");
  for (const p of extra) revalidatePath(p);
}

function visibilityOf(input: string | undefined): PostVisibility {
  return (POST_VISIBILITIES as readonly string[]).includes(input ?? "") ? (input as PostVisibility) : "followers";
}

// ---------- follows ----------

export async function follow(targetId: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
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
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
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
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (!payloadIsSafe(input.payload)) return { ok: false, message: "Payload carries private data" };
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
  // Kept as entered, to the two decimals the measurements column holds — never rounded to a whole kilo.
  if (typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0) payload.weight_kg = Math.round(weightKg * 100) / 100;
  return insertPost({ type: "progress", text: clean, payload, visibility: visibilityOf(visibility) });
}

/**
 * A one-shot permission to upload one photo for a post. Same shape as the
 * avatar ticket: the signature covers the exact folder and public_id, so the
 * browser posts the file straight to Cloudinary without it ever passing
 * through a server action's body limit, and cannot widen where it lands.
 */
export async function requestPostPhotoUpload(): Promise<ActionResult & { ticket?: PostPhotoUploadTicket }> {
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  try {
    return { ok: true, ticket: signPostPhotoUpload(uid) };
  } catch (error) {
    if (error instanceof CloudinaryNotConfiguredError) {
      console.error(error.message);
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

/**
 * Rebuild the delivery URL from an upload this server signed. The browser
 * hands back the public_id and version Cloudinary answered with; anything
 * outside this person's own post folder is refused, and the URL itself is
 * composed here rather than trusted.
 */
async function resolvePostPhoto(uid: string, photo: { publicId: string; version: number } | null | undefined): Promise<string | null> {
  if (!photo) return null;
  if (!cloudinaryConfigured()) return null;
  if (typeof photo.publicId !== "string" || !photo.publicId.startsWith(`${postPhotoFolder(uid)}/`)) return null;
  if (!Number.isInteger(photo.version) || photo.version <= 0) return null;
  return postPhotoUrl(photo.publicId, photo.version);
}

/** Share a finished session: the aggregates only, snapshotted now, plus an optional photo the author picked. */
export async function shareWorkout(
  sessionId: string,
  visibility?: string,
  text?: string,
  photo?: { publicId: string; version: number } | null,
): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const s = await getShareableSession(sessionId);
  if (!s) return { ok: false, message: t.common.social.notFound };
  const caption = text ? validatePostText(text) : null;
  const photoUrl = await resolvePostPhoto(uid, photo);
  return insertPost({
    type: "workout",
    text: caption,
    payload: workoutPostPayload({ name: s.name, date: s.date, duration_min: s.duration_min, exercises: s.exercises, sets: s.sets, volume_kg: s.volume_kg, load: s.load, prs: s.prs.length, photo_url: photoUrl }),
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
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
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
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
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

/**
 * Comment on a post, or reply to a comment on it.
 *
 * Mentions are written as ROWS, not parsed out of the body at read time: the
 * handles the author typed are resolved to ids here and stored in
 * social_comment_mentions, and the renderer links a handle only when a row
 * says so. So a body containing "@someone" cannot fabricate a link, and no
 * markup is ever produced from user input.
 *
 * A mention grants nothing. The notification trigger checks the mentioned
 * person's own visibility of the post, so naming somebody in a comment on a
 * private post is silent — see notify_new_mention().
 */
export async function addComment(
  postId: string,
  body: string,
  parentId?: string | null,
): Promise<ActionResult & { id?: string }> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const clean = validateComment(body);
  if (!clean) return { ok: false, message: t.common.social.commentInvalid };
  const supabase = await supabaseServer();

  const { data: created, error } = await supabase
    .from("social_comments")
    .insert({ post_id: postId, user_id: uid, body: clean, parent_id: parentId ?? null })
    .select("id")
    .single();
  // The insert is gated by comments_insert (your own row, on a post you can
  // see) and by the depth trigger. Both surface here as an error rather than a
  // silent no-op.
  if (error) return { ok: false, message: t.common.social.commentInvalid };

  const handles = extractMentionHandles(clean);
  if (handles.length > 0) {
    // users_select hides everyone who is not the reader's coach or client, so
    // the lookup goes through a security-definer RPC that returns nothing but
    // id and username.
    const { data: known } = await supabase.rpc("social_resolve_handles", { p_handles: handles });
    type HandleRow = { id: string; username: string };
    const mentions = resolveMentions(
      handles,
      ((known ?? []) as HandleRow[]).map((k) => ({ user_id: k.id, username: k.username })),
    );
    if (mentions.length > 0) {
      // Best effort: a comment that saved but whose mentions did not is still
      // a comment. Failing the whole action here would lose what was typed.
      const { error: mentionError } = await supabase
        .from("social_comment_mentions")
        .insert(mentions.map((m) => ({ comment_id: created.id, user_id: m.user_id })));
      if (mentionError) console.error("mentions not written:", mentionError.message);
    }
  }

  touched([`/feed/${postId}`]);
  return { ok: true, id: created.id as string };
}

/** Who "@mar" could mean, for the composer's suggestion list. */
export async function mentionCandidates(query: string, postId: string | null): Promise<PersonRow[]> {
  const uid = await currentActorId();
  if (!uid) return [];
  return getMentionCandidates(query, postId);
}

/** One more page of a post's comments. */
export async function loadComments(postId: string, before: string | null = null): Promise<CommentPage> {
  const uid = await currentActorId();
  if (!uid) return { items: [], next_cursor: null };
  return getComments(postId, before);
}

export async function deleteComment(commentId: string, postId: string): Promise<ActionResult> {
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const supabase = await supabaseServer();
  const result = await supabase.from("social_comments").delete({ count: "exact" }).eq("id", commentId).eq("user_id", uid);
  const failure = await mutated(result);
  if (failure) return failure;
  touched([`/feed/${postId}`]);
  return { ok: true };
}
