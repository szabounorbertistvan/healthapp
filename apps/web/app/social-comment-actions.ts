"use server";
// Comments, replies and the mention lookup. Mention rows are written here;
// the renderer links a handle only when a row says so.
import { validateComment } from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { currentActorId } from "@/lib/actor";
import { supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { getComments, getMentionCandidates, getReplies } from "@/lib/social-data";
import type { CommentPage, PersonRow, PostComment } from "@/lib/types";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { touched, writeMentions } from "@/lib/social-write";



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
