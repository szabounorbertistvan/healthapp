import "server-only";
import { currentActorId } from "./actor";
import { supabaseServer } from "./supabase/server";
import type { Story, StoryTrayItem, StoryViewerRow } from "./types";

// Stories reads. Every one is a security-definer RPC that applies the
// audience rule and the 24-hour cutoff itself (20261004100000), so what the
// page leaves out is also what a hand-made request gets back.

/**
 * The row across the top of the feed, already ordered by the database: you,
 * then authors with something unseen, then the rest, newest first.
 *
 * A failed read is an empty row, not a broken feed — Stories are the least
 * important thing on the page, and before the migration is applied the RPC
 * simply does not exist yet.
 */
export async function getStoryTray(): Promise<StoryTrayItem[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("social_story_tray");
  if (error) {
    console.error("story tray read failed:", error.message);
    return [];
  }
  return (data ?? []) as StoryTrayItem[];
}

/** One author's live stories, oldest first — the order they are played in. */
export async function getUserStories(userId: string): Promise<Story[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("social_user_stories", { p_user: userId });
  if (error) throw new Error(error.message);
  return (data ?? []) as Story[];
}

export const STORY_VIEWERS_PAGE = 50;

/** Who opened one of your stories. Anyone else's story, or an expired one, is an empty list. */
export async function getStoryViewers(storyId: string, before: string | null = null): Promise<StoryViewerRow[]> {
  const viewer = await currentActorId();
  if (!viewer) return [];
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("social_story_viewers", {
    p_story: storyId, p_limit: STORY_VIEWERS_PAGE, p_before: before,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoryViewerRow[];
}
