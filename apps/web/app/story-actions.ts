"use server";
// Stories writes, and the viewer's on-demand reads. Every write goes as the
// signed-in user through RLS (social_stories) or through an RPC that writes
// only auth.uid() (social_mark_story_seen); none of them sends a notification.
import { revalidatePath } from "next/cache";
import { isStoryBackground, validateStoryText, type StoryBackground } from "@healthapp/shared";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { currentActorId } from "@/lib/actor";
import { getI18n } from "@/lib/i18n/server";
import { getStoryViewers, getUserStories } from "@/lib/stories-data";
import { mutated } from "@/lib/supabase/mutate";
import { supabaseServer } from "@/lib/supabase/server";
import type { Story, StoryViewerRow } from "@/lib/types";

/**
 * Share a story. Only the text and the background travel: the author is the
 * signed-in user (RLS checks it again), and the times are the database's —
 * a trigger overwrites whatever a client might send.
 */
export async function publishStory(text: string, background: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const s = t.common.stories;
  const clean = validateStoryText(text);
  if (!clean.ok) return { ok: false, message: s.textInvalid };
  const bg: StoryBackground = isStoryBackground(background) ? background : "gold";
  const supabase = await supabaseServer();
  const { error } = await supabase.from("social_stories").insert({ user_id: uid, body: clean.text, background: bg });
  if (error) {
    // 54000: the live-story cap in the insert trigger.
    return { ok: false, message: error.code === "54000" ? s.tooMany : s.failed };
  }
  revalidatePath("/feed");
  return { ok: true };
}

/** Delete one of your own stories. RLS turns anyone else's into zero rows, which mutated() reports. */
export async function deleteStory(storyId: string): Promise<ActionResult> {
  const uid = await currentActorId();
  if (!uid) return notSignedIn;
  const supabase = await supabaseServer();
  const failure = await mutated(
    await supabase.from("social_stories").delete({ count: "exact" }).eq("id", storyId).eq("user_id", uid),
  );
  if (failure) return failure;
  revalidatePath("/feed");
  return { ok: true };
}

/**
 * "I opened this story." Idempotent in the database; silent for your own.
 * No revalidation: the viewer updates its own rings, and the feed catches up
 * when the viewer closes and refreshes.
 */
export async function markStorySeen(storyId: string): Promise<{ ok: boolean; expired?: boolean }> {
  const uid = await currentActorId();
  if (!uid) return { ok: false };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("social_mark_story_seen", { p_story: storyId });
  // P0002: expired while it was on screen, or no longer yours to see.
  if (error) return { ok: false, expired: error.code === "P0002" };
  return { ok: true };
}

/** One author's live stories, for the viewer as it reaches them. */
export async function loadStories(userId: string): Promise<{ ok: true; stories: Story[] } | { ok: false }> {
  try {
    return { ok: true, stories: await getUserStories(userId) };
  } catch {
    return { ok: false };
  }
}

/** Who has seen one of your stories; empty for anyone else's. */
export async function loadStoryViewers(storyId: string): Promise<{ ok: true; viewers: StoryViewerRow[] } | { ok: false }> {
  try {
    return { ok: true, viewers: await getStoryViewers(storyId) };
  } catch {
    return { ok: false };
  }
}
