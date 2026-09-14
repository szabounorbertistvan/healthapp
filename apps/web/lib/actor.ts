import "server-only";
import { currentUserId } from "./supabase/server";

/**
 * Who this request is acting as — the signed-in user.
 *
 * Kept as its own name because every client-surface read calls it, and because
 * it used to resolve a demo view-switcher identity as well. Now it is a
 * straight re-export in function form; the indirection costs nothing and keeps
 * the call sites honest about intent.
 */
export async function currentActorId(): Promise<string | null> {
  return currentUserId();
}
