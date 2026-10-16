import "server-only";
// Shared by the social write actions. These are not actions: a "use server"
// file can only export what the browser is allowed to call.
import { revalidatePath } from "next/cache";
import {
  extractMentionHandles, mentionChanges, payloadIsSafe, payloadMatchesType, POST_VISIBILITIES, resolveMentions,
  type MentionRef, type PostPayload, type PostType, type PostVisibility,
} from "@healthapp/shared";
import { currentActorId } from "@/lib/actor";
import { supabaseServer } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/actions";
import { notSignedIn } from "@/lib/action-result";



export type PostResult = ActionResult & { postId?: string };



export function touched(extra: string[] = []) {
  revalidatePath("/feed");
  revalidatePath("/people", "layout");
  for (const p of extra) revalidatePath(p);
}



export function visibilityOf(input: string | undefined): PostVisibility {
  return (POST_VISIBILITIES as readonly string[]).includes(input ?? "") ? (input as PostVisibility) : "followers";
}



// ---------- posts ----------

export async function insertPost(input: {
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



export type Supabase = Awaited<ReturnType<typeof supabaseServer>>;



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
export async function writeMentions(
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
