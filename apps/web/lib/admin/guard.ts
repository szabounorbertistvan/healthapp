import "server-only";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import type { Profile } from "@/lib/types";

/**
 * The server-side gate for every admin page.
 *
 * `users.role` is the source of truth and only SQL can set it to 'admin'
 * (20260907100000, 20260907110000). The database re-checks on every admin
 * RPC through admin_assert(), so this guard is a courtesy redirect, not the
 * boundary: a non-admin who somehow rendered a page would still get nothing
 * from it. Everyone else is sent to their own surface.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/");
  if (profile.role !== "admin") redirect(profile.role === "client" ? "/today" : "/dashboard");
  if (!profile.username) redirect("/complete-profile");
  return profile;
}

/**
 * The same check for server actions, which answer a result instead of
 * redirecting. The RPCs raise ADMIN_ONLY regardless; this exists so a
 * non-admin gets a clean message rather than a raw PostgREST error.
 */
export async function adminActor(): Promise<Profile | null> {
  const profile = await getProfile();
  return profile?.role === "admin" ? profile : null;
}
