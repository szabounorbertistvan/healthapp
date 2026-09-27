import "server-only";
import { currentActorId } from "./actor";
import { supabaseServer } from "./supabase/server";

/**
 * Whether the signed-in person has blocked / muted someone. Read from their
 * own rows only — RLS lets nobody read a block or a mute they did not make,
 * so being blocked or muted is never something a person can look up.
 * Pages normally get the same flags from social_profile / social_feed; this
 * is for the places that have only an id.
 */
export async function isBlocked(userId: string): Promise<boolean> {
  const viewer = await currentActorId();
  if (!viewer) return false;
  const supabase = await supabaseServer();
  const { data } = await supabase.from("social_user_blocks").select("blocked_id").eq("blocker_id", viewer).eq("blocked_id", userId).maybeSingle();
  return Boolean(data);
}

export async function isMuted(userId: string): Promise<boolean> {
  const viewer = await currentActorId();
  if (!viewer) return false;
  const supabase = await supabaseServer();
  const { data } = await supabase.from("social_user_mutes").select("muted_id").eq("muter_id", viewer).eq("muted_id", userId).maybeSingle();
  return Boolean(data);
}
