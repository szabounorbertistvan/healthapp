"use server";
// Social feed writes. Each one writes only as the signed-in user (RLS
// re-checks that), and every post that comes from data is a SNAPSHOT built
// here from rows the user owns — the feed never reads their logs later.
import { revalidatePath } from "next/cache";
import { insertPost, touched, visibilityOf, writeMentions, type PostResult, type Supabase } from "@/lib/social-write";
import {
  POST_MEDIA_MAX,
  isPostMediaPublicId,
  normalizeMediaItems,
  normalizePhotoOverlay,
  storedMediaProblem,
  type PhotoOverlay,
  type PostMediaInput,
  STREAK_SHARE_MIN,
  payloadIsSafe,
  isReactionType,
  normalizePostPhoto,
  postPhotoOf,
  validatePostEdit,
  isPostId,
  prPostPayload,
  sharedPostPayload,
  validatePostText,
  workoutPostPayload,
  type ChallengePostPayload,
  type PostPayload,
  type PostType,
  type PostVisibility,
  type PrPostPayload,
  type ProgressPostPayload,
  type ReactionType,
  type StreakPostPayload,
} from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import {
  CloudinaryNotConfiguredError, cloudinaryConfigured, destroyPostMedia, lookupPostMedia,
  signPostMediaUpload, type PostMediaUploadTicket,
} from "@/lib/cloudinary";
import { currentActorId } from "@/lib/actor";
import { supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { getPostKudos, getShareableSession } from "@/lib/social-data";
import { getChallenge } from "@/lib/challenges-data";
import { getMyStreak } from "@/lib/streak-data";
import type { KudosPage, PostMediaItem } from "@/lib/types";
import { toMediaItems } from "@/lib/post-media-data";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";

export async function createTextPost(text: string, visibility?: string, media?: PostMediaInput[] | null): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  // A picture is a post on its own; words are optional next to it. Without
  // one the words are the post, so 1–500 of them.
  const clean = validatePostEdit("text", text, (media?.length ?? 0) > 0);
  if (!clean.ok) return { ok: false, message: t.common.social.textInvalid };
  return insertMediaPost(uid, { type: "text", text: clean.text, payload: null, visibility: visibilityOf(visibility) }, media);
}

/** A progress post: text, optionally the weight the author typed in, optionally a picture. Never read from measurements. */
export async function createProgressPost(
  text: string,
  visibility?: string,
  weightKg?: number | null,
  media?: PostMediaInput[] | null,
): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const payload: ProgressPostPayload = { kind: "progress", ...normalizePostPhoto(null, false) };
  // Same rule as a text post: a picture alone is enough, otherwise the words are required.
  const clean = validatePostEdit("text", text, (media?.length ?? 0) > 0);
  if (!clean.ok) return { ok: false, message: t.common.social.textInvalid };
  // Kept as entered, to the two decimals the measurements column holds — never rounded to a whole kilo.
  if (typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0) payload.weight_kg = Math.round(weightKg * 100) / 100;
  return insertMediaPost(uid, { type: "progress", text: clean.text, payload, visibility: visibilityOf(visibility) }, media);
}

/**
 * A text or progress post and its pictures, in one transaction
 * (social_create_post, security invoker — every policy applies).
 *
 * Before it, what Cloudinary actually stored is checked for each picture —
 * format, bytes and pixel size as Cloudinary decoded them, never as the
 * browser claimed — and the stored size is what the post records. The
 * database then checks the rest: each id was issued to this author, is
 * unused, at most ten. The overlay is kept only on a single-picture post.
 */
async function insertMediaPost(
  uid: string,
  input: { type: "text" | "progress" | "workout"; text: string | null; payload: PostPayload; visibility: PostVisibility; activity_id?: string | null },
  media: PostMediaInput[] | null | undefined,
): Promise<PostResult> {
  const { t } = await getI18n();
  const s = t.common.social;
  if (!payloadIsSafe(input.payload)) return { ok: false, message: "Payload carries private data" };
  const items = normalizeMediaItems(media ?? [], uid);
  if (!items) return { ok: false, message: s.mediaPublishFailed };
  let rows: { public_id: string; width: number; height: number; alt: string | null; overlay: PhotoOverlay | null }[] = [];
  if (items.length > 0) {
    if (!cloudinaryConfigured()) return { ok: false, message: s.mediaPublishFailed };
    let stored: Awaited<ReturnType<typeof lookupPostMedia>>;
    try {
      stored = await lookupPostMedia(items.map((i) => i.public_id));
    } catch (error) {
      console.error("post media lookup failed:", error);
      return { ok: false, message: s.mediaPublishFailed };
    }
    for (const item of items) {
      if (storedMediaProblem(stored.get(item.public_id))) return { ok: false, message: s.mediaPublishFailed };
    }
    // Only a workout's overlay may carry its figures.
    const overlay = items.length === 1 ? normalizePhotoOverlay(media?.[0]?.overlay ?? null, input.type === "workout") : null;
    rows = items.map((item, i) => {
      const asset = stored.get(item.public_id)!;
      return { ...item, width: asset.width!, height: asset.height!, overlay: i === 0 ? overlay : null };
    });
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("social_create_post", {
    p_type: input.type,
    p_text: input.text,
    p_visibility: input.visibility,
    p_payload: input.payload,
    p_media: rows,
    p_activity_id: input.activity_id ?? null,
  });
  // 23505: the one-post-per-session index — this workout is already shared.
  if (error?.code === "23505" && input.type === "workout") return { ok: true };
  if (error || typeof data !== "string") {
    if (error) console.error("create post failed:", error.code, error.message);
    return { ok: false, message: rows.length > 0 ? s.mediaPublishFailed : s.textInvalid };
  }
  if (input.text) await writeMentions(supabase, "post", data, input.text);
  touched();
  return { ok: true, postId: data };
}

/**
 * Permission to upload `count` pictures (1–10): the database issues the
 * public_ids (social_media_upload_register — at most 60 an hour, active
 * accounts only) and this signs one Cloudinary upload for each, private and
 * restricted to jpg / png / webp by Cloudinary itself.
 *
 * Also the moment abandoned uploads are cleaned up: anything this person was
 * issued more than a day ago and never used is deleted from Cloudinary first,
 * then marked. Best effort — a failure here never blocks the new upload.
 */
export async function requestPostMediaUploads(count: number): Promise<ActionResult & { tickets?: PostMediaUploadTicket[] }> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (!Number.isInteger(count) || count < 1 || count > POST_MEDIA_MAX) return { ok: false, message: t.common.social.photoFailed };
  if (!cloudinaryConfigured()) return { ok: false, message: t.common.social.photoFailed };
  const supabase = await supabaseServer();
  await discardUploads(supabase, null);
  const { data, error } = await supabase.rpc("social_media_upload_register", { p_count: count });
  if (error || !Array.isArray(data)) {
    if (error) console.error("upload register failed:", error.code, error.message);
    return { ok: false, message: error?.code === "54000" ? t.common.social.mediaTooMany : t.common.social.photoFailed };
  }
  try {
    return { ok: true, tickets: (data as string[]).map((publicId) => signPostMediaUpload(uid, publicId)) };
  } catch (error) {
    if (error instanceof CloudinaryNotConfiguredError) console.error(error.message);
    else console.error("upload signing failed:", error);
    return { ok: false, message: t.common.social.photoFailed };
  }
}

/**
 * Throw away uploads the composer no longer needs (a removed picture, a
 * closed composer). Only this person's own, never-used uploads: anything
 * else named here is ignored.
 */
export async function discardPostMedia(publicIds: string[]): Promise<ActionResult> {
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const ids = Array.isArray(publicIds) ? publicIds.filter((id) => isPostMediaPublicId(id, uid)).slice(0, 100) : [];
  if (ids.length === 0) return { ok: true };
  await discardUploads(await supabaseServer(), ids);
  return { ok: true };
}

/** Delete the assets first, then mark the rows — so a failed delete is retried by the next sweep. */
async function discardUploads(supabase: Supabase, ids: string[] | null): Promise<void> {
  if (!cloudinaryConfigured()) return;
  try {
    const { data } = await supabase.rpc("social_media_discardable", { p_ids: ids });
    const doomed = Array.isArray(data) ? (data as string[]) : [];
    if (doomed.length === 0) return;
    await destroyPostMedia(doomed);
    await supabase.rpc("social_media_mark_discarded", { p_ids: doomed });
  } catch (error) {
    console.error("discarding uploads failed:", error);
  }
}

/**
 * Share a finished session: the aggregates only, and the pictures the author
 * picked — private media rows, like every post's (20261017100000). The payload
 * sent here is a courtesy: social_posts_guard rebuilds it from the session.
 * A single picture keeps its overlay, the workout's figures included.
 */
export async function shareWorkout(
  sessionId: string,
  visibility?: string,
  text?: string,
  media?: PostMediaInput[] | null,
): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const s = await getShareableSession(sessionId);
  if (!s) return { ok: false, message: t.common.social.notFound };
  const caption = text ? validatePostText(text) : null;
  return insertMediaPost(uid, {
    type: "workout",
    text: caption,
    payload: workoutPostPayload({
      name: s.name, date: s.date, duration_min: s.duration_min, exercises: s.exercises, sets: s.sets,
      volume_kg: s.volume_kg, load: s.load, prs: s.prs.length,
    }),
    visibility: visibilityOf(visibility),
    activity_id: sessionId,
  }, media);
}

/**
 * Fresh links for a post's pictures. A page mints /api/media links that live
 * 5–10 minutes; a picture scrolled to later, or a story exported from a page
 * left open, asks for new ones here. The same read as the page (social_post:
 * can_see_post and every rule behind it), so this hands out nothing the
 * reader could not already see.
 */
export async function refreshPostMedia(postId: string): Promise<PostMediaItem[]> {
  const uid = await currentActorId();
  if (!uid || typeof postId !== "string") return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("social_post", { p_post: postId });
  if (error) return [];
  const row = ((data ?? []) as { type?: string; media?: unknown }[])[0];
  return row ? toMediaItems(row.media, row.type === "workout") : [];
}

/** Share one PR the PR engine flagged in a session. */
export async function sharePr(sessionId: string, setId: string, visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const s = await getShareableSession(sessionId);
  const pr = s?.prs.find((p) => p.set_id === setId);
  if (!s || !pr) return { ok: false, message: t.common.social.notFound };
  if (pr.shared) return { ok: true };
  // The database rebuilds every number from the set named here
  // (social_posts_guard) and keeps nothing else we send.
  const payload: PrPostPayload = prPostPayload(pr, s.date);
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

/**
 * Change the caption of your own post. Only `text`: the update grant on
 * social_posts is column-level (text, visibility, deleted_at), so the
 * snapshot, the author and the type cannot change even through PostgREST, and
 * the database stamps edited_at. A text post must keep 1–500 characters; a
 * data post (workout, PR, badge…) may drop its caption entirely. Mentions are
 * re-resolved, so a handle removed from the text stops being a link.
 */
export async function editPost(postId: string, text: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const supabase = await supabaseServer();
  // Own and not deleted — anything else reads as absent, never as someone else's.
  const { data: post } = await supabase
    .from("social_posts")
    .select("type, payload")
    .eq("id", postId)
    .eq("user_id", uid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!post) return { ok: false, message: t.common.social.postNotFound };

  const { count: pictures } = await supabase
    .from("social_post_media")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId);
  const hasPhoto = postPhotoOf((post.payload ?? null) as PostPayload) !== null || (pictures ?? 0) > 0;
  const edit = validatePostEdit(post.type as PostType, text, hasPhoto);
  if (!edit.ok) return { ok: false, message: t.common.social.textInvalid };
  const clean = edit.text;

  const failure = await mutated(
    await supabase.from("social_posts").update({ text: clean }, { count: "exact" }).eq("id", postId).eq("user_id", uid),
  );
  if (failure) return failure;
  await writeMentions(supabase, "post", postId, clean ?? "", true);
  touched([`/feed/${postId}`]);
  return { ok: true };
}

// ---------- save ----------

/**
 * Save or unsave a post — the state asked for, not a toggle, so a retry or a
 * race lands where the tap meant. Both directions are idempotent: saving
 * twice is ignored by the primary key, unsaving what is not saved is done.
 * RLS allows a save only of a post the caller may see now; nobody is told,
 * and nothing counts saves.
 */
export async function setPostSaved(postId: string, save: boolean): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (!isPostId(postId)) return { ok: false, message: t.common.social.postNotFound };
  const supabase = await supabaseServer();
  const { error } = save
    ? await supabase
        .from("social_post_saves")
        .upsert({ user_id: uid, post_id: postId }, { onConflict: "user_id,post_id", ignoreDuplicates: true })
    : await supabase.from("social_post_saves").delete().eq("user_id", uid).eq("post_id", postId);
  if (error) {
    // 42501: RLS refused it — the post is gone or not visible to this user.
    return { ok: false, message: error.code === "42501" ? t.common.social.postNotFound : t.common.social.saveError };
  }
  revalidatePath("/saved");
  return { ok: true };
}

// ---------- share to Voinic ----------

/**
 * Share someone else's post to your own feed, with an optional caption of
 * your own. Only the id of the post travels; the database (social_posts_guard)
 * checks the sharer may see it, resolves a share of a share to its original,
 * refuses your own post, and rebuilds the payload itself — so nothing here,
 * and nothing a hand-made request sends, can put words in the original's
 * mouth or change who wrote it. The sharer is always the signed-in user.
 */
export async function sharePost(postId: string, text: string, visibility?: string): Promise<PostResult> {
  const { t } = await getI18n();
  const s = t.common.social;
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const payload = sharedPostPayload(postId);
  if (!payload) return { ok: false, message: s.shareFailed };
  const caption = validatePostEdit("shared_post", text ?? "");
  if (!caption.ok) return { ok: false, message: s.textInvalid };
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("social_posts")
    .insert({ user_id: uid, type: "shared_post", text: caption.text, payload, visibility: visibilityOf(visibility) })
    .select("id")
    .single();
  if (error) {
    // 22023 from the guard: your own post. P0002: missing, deleted or not yours to see.
    return { ok: false, message: error.code === "22023" ? s.cannotShareOwn : s.shareFailed };
  }
  if (caption.text) await writeMentions(supabase, "post", data.id as string, caption.text);
  touched();
  return { ok: true, postId: data.id as string };
}

// ---------- reactions ----------

export type ReactResult = ActionResult & { reaction?: ReactionType | null };

/**
 * Press one of the two reactions. The database does the flip (social_react:
 * same button again = take it back, the other one = replace it) as the
 * caller, so reactions_insert (can_kudos_post: visible, not your own) is what
 * decides. `reaction` in the result is the state the row is in afterwards, so
 * the card can settle on the truth when two taps race.
 */
export async function react(postId: string, pressed: ReactionType): Promise<ReactResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  if (!isReactionType(pressed)) return { ok: false, message: t.common.social.kudosError };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("social_react", { p_post: postId, p_type: pressed });
  if (error) {
    // 42501 = RLS refused it (a post you cannot see, or your own); anything else is a real failure.
    return { ok: false, message: error.code === "42501" ? t.common.social.cannotKudosSelf : error.message };
  }
  // No revalidatePath here on purpose: the feed is dynamic (re-read on every
  // navigation anyway), and a revalidation makes the action's own response
  // carry a re-render of the whole page — a full second on top of a 300 ms
  // write, for a count the card already moved on its own.
  return { ok: true, reaction: isReactionType(data) ? data : null };
}

/** One page of who reacted, for the list behind the counts. A read, but on demand from the card. */
export async function loadKudos(postId: string, before: string | null = null): Promise<KudosPage> {
  return getPostKudos(postId, before);
}
