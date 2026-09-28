"use server";
// Social feed writes. Each one writes only as the signed-in user (RLS
// re-checks that), and every post that comes from data is a SNAPSHOT built
// here from rows the user owns — the feed never reads their logs later.
import { revalidatePath } from "next/cache";
import {
  POST_VISIBILITIES,
  STREAK_SHARE_MIN,
  payloadIsSafe,
  extractMentionHandles,
  fitnessScorePostPayload,
  isBadgeSlug,
  isProfileVisibility,
  isReactionType,
  normalizePostPhoto,
  payloadMatchesType,
<<<<<<< HEAD
  mentionChanges,
=======
  postPhotoOf,
>>>>>>> 715e1ffed24a8b9e8701057f295ef5652cb0bdde
  resolveMentions,
  validateComment,
  validatePostEdit,
  isPostId,
  prPostPayload,
  sharedPostPayload,
  validatePostText,
  workoutPostPayload,
  type ChallengePostPayload,
  type MentionRef,
  type PostPayload,
  type PostPhotoFields,
  type PostType,
  type PostVisibility,
  type PrPostPayload,
  type ProgressPostPayload,
  type ReactionType,
  type StreakPostPayload,
} from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { CloudinaryNotConfiguredError, cloudinaryConfigured, postPhotoFolder, postPhotoUrl, signPostPhotoUpload, type PostPhotoUploadTicket } from "@/lib/cloudinary";
import { currentActorId } from "@/lib/actor";
import { supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { getComments, getMentionCandidates, getPostKudos, getReplies, getShareableSession } from "@/lib/social-data";
import { getMyFitnessScore } from "@/lib/fitness-score-data";
import { getChallenge } from "@/lib/challenges-data";
import { getMyStreak } from "@/lib/streak-data";
import type { CommentPage, KudosPage, PersonRow, PostComment } from "@/lib/types";
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
  if (!payloadMatchesType(input.type, input.payload)) return { ok: false, message: "Payload does not match the post type" };
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
  if (input.text) await writeMentions(supabase, "post", data.id as string, input.text);
  touched();
  return { ok: true, postId: data.id };
}

type Supabase = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Resolve the handles typed in a caption or comment and store them as rows.
 *
 * users_select hides everyone who is not the reader's coach or client, so the
 * lookup goes through a security-definer RPC that returns nothing but id and
 * username. Best effort: text that saved but whose mentions did not is still
 * text — failing the whole action would lose what was typed. The notification
 * trigger decides who hears about it, as the mentioned person (a mention
 * grants nothing).
 *
 * `replace` is for an edit: only the difference is written (mentionChanges).
 * A handle that was removed stops being a link — the database also prunes it
 * when the text changes — and a handle that stayed keeps its row, so nobody
 * is notified twice for one comment or post.
 */
async function writeMentions(
  supabase: Supabase,
  target: "post" | "comment",
  id: string,
  text: string,
  replace = false,
): Promise<void> {
  const table = target === "post" ? "social_post_mentions" : "social_comment_mentions";
  const column = target === "post" ? "post_id" : "comment_id";
  const handles = extractMentionHandles(text);
  let mentions: MentionRef[] = [];
  if (handles.length > 0) {
    const { data: known } = await supabase.rpc("social_resolve_handles", { p_handles: handles });
    type HandleRow = { id: string; username: string };
    mentions = resolveMentions(
      handles,
      ((known ?? []) as HandleRow[]).map((k) => ({ user_id: k.id, username: k.username })),
    );
  }
  let add = mentions;
  if (replace) {
    const { data: rows } = await supabase.from(table).select("user_id").eq(column, id);
    const change = mentionChanges(((rows ?? []) as { user_id: string }[]).map((r) => r.user_id), mentions);
    add = change.add;
    if (change.remove.length > 0) {
      const { error } = await supabase.from(table).delete().eq(column, id).in("user_id", change.remove);
      if (error) console.error(`${table} not cleared:`, error.message);
    }
  }
  if (add.length === 0) return;
  const { error } = await supabase.from(table).insert(add.map((m) => ({ [column]: id, user_id: m.user_id })));
  if (error) console.error(`${table} not written:`, error.message);
}

/**
 * What the browser hands back after uploading a picture: the public_id and
 * version Cloudinary answered with, the pixel size it uploaded (it resized the
 * file itself before sending), and what it placed on top of the picture.
 */
export type PostPhotoInput = {
  publicId: string;
  version: number;
  width?: number | null;
  height?: number | null;
  overlay?: unknown;
};

export async function createTextPost(text: string, visibility?: string, photo?: PostPhotoInput | null): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const picture = await resolvePostPhoto(uid, photo, false);
  // A photo is a post on its own; words are optional next to it. Without a
  // photo the words are the post, so 1–500 of them.
  const clean = validatePostEdit("text", text, Boolean(picture.photo_url));
  if (!clean.ok) return { ok: false, message: t.common.social.textInvalid };
  return insertPost({
    type: "text",
    text: clean.text,
    payload: picture.photo_url ? { kind: "text", ...picture } : null,
    visibility: visibilityOf(visibility),
  });
}

/** A progress post: text, optionally the weight the author typed in, optionally a picture. Never read from measurements. */
export async function createProgressPost(
  text: string,
  visibility?: string,
  weightKg?: number | null,
  photo?: PostPhotoInput | null,
): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const payload: ProgressPostPayload = { kind: "progress", ...(await resolvePostPhoto(uid, photo, false)) };
  // Same rule as a text post: the photo alone is enough, otherwise the words are required.
  const clean = validatePostEdit("text", text, Boolean(payload.photo_url));
  if (!clean.ok) return { ok: false, message: t.common.social.textInvalid };
  // Kept as entered, to the two decimals the measurements column holds — never rounded to a whole kilo.
  if (typeof weightKg === "number" && Number.isFinite(weightKg) && weightKg > 0) payload.weight_kg = Math.round(weightKg * 100) / 100;
  return insertPost({ type: "progress", text: clean.text, payload, visibility: visibilityOf(visibility) });
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
async function resolvePostPhoto(uid: string, photo: PostPhotoInput | null | undefined, allowStats: boolean): Promise<PostPhotoFields> {
  const none = normalizePostPhoto(null, allowStats);
  if (!photo) return none;
  if (!cloudinaryConfigured()) return none;
  if (typeof photo.publicId !== "string" || !photo.publicId.startsWith(`${postPhotoFolder(uid)}/`)) return none;
  if (!Number.isInteger(photo.version) || photo.version <= 0) return none;
  return normalizePostPhoto(
    { url: postPhotoUrl(photo.publicId, photo.version), width: photo.width, height: photo.height, overlay: photo.overlay },
    allowStats,
  );
}

/** Share a finished session: the aggregates only, snapshotted now, plus an optional photo the author picked. */
export async function shareWorkout(
  sessionId: string,
  visibility?: string,
  text?: string,
  photo?: PostPhotoInput | null,
): Promise<PostResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const s = await getShareableSession(sessionId);
  if (!s) return { ok: false, message: t.common.social.notFound };
  const caption = text ? validatePostText(text) : null;
  const picture = await resolvePostPhoto(uid, photo, true);
  return insertPost({
    type: "workout",
    text: caption,
    payload: workoutPostPayload({
      name: s.name, date: s.date, duration_min: s.duration_min, exercises: s.exercises, sets: s.sets,
      volume_kg: s.volume_kg, load: s.load, prs: s.prs.length,
      photo: { url: picture.photo_url ?? null, width: picture.photo_w, height: picture.photo_h, overlay: picture.overlay },
    }),
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

  const edit = validatePostEdit(post.type as PostType, text, postPhotoOf((post.payload ?? null) as PostPayload) !== null);
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

<<<<<<< HEAD
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

// ---------- kudos ----------
=======
// ---------- reactions ----------
>>>>>>> 715e1ffed24a8b9e8701057f295ef5652cb0bdde

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

  await writeMentions(supabase, "comment", created.id as string, clean);

  // No revalidatePath: the feed and the post page are dynamic and re-read on
  // every navigation, and the callers reload what they show themselves (the
  // card refetches the thread, the post page refreshes). A revalidation here
  // would make this response carry a re-render of the whole page.
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

/**
 * Change the body of your own comment. The update grant is column-level
 * (body only), comments_update requires it to be yours on a post you can
 * still see, and the database stamps edited_at — so the "edited" label is not
 * something the browser can leave off.
 */
export async function editComment(commentId: string, postId: string, body: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const clean = validateComment(body);
  if (!clean) return { ok: false, message: t.common.social.commentInvalid };
  const supabase = await supabaseServer();
  const failure = await mutated(
    await supabase.from("social_comments").update({ body: clean }, { count: "exact" }).eq("id", commentId).eq("user_id", uid),
  );
  if (failure) return failure;
  await writeMentions(supabase, "comment", commentId, clean, true);
  touched([`/feed/${postId}`]);
  return { ok: true };
}

/** More replies under one comment, after the last one on screen. */
export async function loadReplies(parentId: string, after: string | null): Promise<{ items: PostComment[]; next_cursor: string | null }> {
  const uid = await currentActorId();
  if (!uid) return { items: [], next_cursor: null };
  return getReplies(parentId, after);
}

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
