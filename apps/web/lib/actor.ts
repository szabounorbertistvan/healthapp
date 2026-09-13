import "server-only";
import { currentUserId, isDemo } from "./supabase/server";
import { viewingClientId } from "./view-mode";

/**
 * Who this request is acting as.
 *
 * Demo mode has no auth, so the view-switcher client stands in. Live mode is
 * the signed-in user. Every client-surface read used to reimplement this
 * three-line branch (`me()`, `userId()`, `currentClientId()`).
 */
export async function currentActorId(): Promise<string | null> {
  if (isDemo) return viewingClientId();
  return currentUserId();
}
