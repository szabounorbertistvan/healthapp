// Server side of the external share card: the workout comes from the same
// owner-scoped read the feed uses (getShareableSession — `user_id = viewer`
// on top of RLS, so another person's session id yields nothing), the author
// from the request's cached profile. Nothing here trusts a number from the
// client; the browser only ever sends a session id.
import "server-only";
import { displayName, getProfile } from "./data";
import { getShareableSession } from "./social-data";
import { shareCardFromSession, type ShareCardProfile, type WorkoutShareCard } from "./share-card";
import type { Profile } from "./types";

/** The author line of a card — username first, never the email. */
export function shareProfileOf(profile: Pick<Profile, "full_name" | "username" | "avatar_url"> | null): ShareCardProfile | null {
  if (!profile) return null;
  return { name: displayName(profile), username: profile.username, avatar_url: profile.avatar_url };
}

/** The card for one of the signed-in user's completed sessions, or null when it is not theirs. */
export async function getWorkoutShareCard(sessionId: string): Promise<WorkoutShareCard | null> {
  const [session, profile] = await Promise.all([getShareableSession(sessionId), getProfile()]);
  if (!session) return null;
  return shareCardFromSession(session, shareProfileOf(profile));
}
