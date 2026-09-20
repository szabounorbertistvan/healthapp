"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { adminActor } from "@/lib/admin/guard";
import { uuidOf } from "@/lib/admin/params";
import type { ActionResult } from "./actions";

/**
 * The admin's write surface. Each one is a single RPC that re-checks
 * is_admin() in SQL, refuses what it must (self-suspension, an admin, an
 * invitation that is not pending, a post already gone) and writes its own
 * audit row — see 20260920100000_admin_panel.sql §2–3. The role check here
 * only turns a raw 42501 into a readable message.
 *
 * Ids come from the page as strings; anything that is not a UUID is refused
 * before it reaches the database.
 */

async function call(name: string, args: Record<string, unknown>, paths: string[]): Promise<ActionResult> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(name, args);
  if (error) return { ok: false, message: error.message };
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

export async function suspendUser(userId: string, reason: string): Promise<ActionResult> {
  const id = uuidOf(userId);
  if (!id) return { ok: false, message: "Invalid id" };
  return call("admin_set_suspended", { p_user: id, p_suspended: true, p_reason: reason.trim().slice(0, 500) || null },
    ["/admin", "/admin/users", `/admin/users/${id}`, "/admin/activity"]);
}

export async function reactivateUser(userId: string): Promise<ActionResult> {
  const id = uuidOf(userId);
  if (!id) return { ok: false, message: "Invalid id" };
  return call("admin_set_suspended", { p_user: id, p_suspended: false, p_reason: null },
    ["/admin", "/admin/users", `/admin/users/${id}`, "/admin/activity"]);
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const id = uuidOf(invitationId);
  if (!id) return { ok: false, message: "Invalid id" };
  return call("admin_revoke_invitation", { p_invitation: id }, ["/admin/invitations", "/admin/activity"]);
}

export async function deletePostAsAdmin(postId: string, reason: string): Promise<ActionResult> {
  const id = uuidOf(postId);
  if (!id) return { ok: false, message: "Invalid id" };
  return call("admin_delete_post", { p_post: id, p_reason: reason.trim().slice(0, 500) || null },
    ["/admin/social", `/admin/social/${id}`, "/admin/activity", "/feed"]);
}

export async function removePushSubscription(subscriptionId: string, userId: string | null): Promise<ActionResult> {
  const id = uuidOf(subscriptionId);
  if (!id) return { ok: false, message: "Invalid id" };
  const user = uuidOf(userId);
  return call("admin_remove_push_subscription", { p_subscription: id },
    ["/admin/notifications", "/admin/activity", ...(user ? [`/admin/users/${user}`] : [])]);
}

/**
 * Called by the login form when a password sign-in is refused. GoTrue keeps
 * no record of a wrong password, so this is the only trace. Metadata only —
 * the address typed, the caller's IP and browser — and never the password.
 * The RPC is anonymous by design (nobody is signed in yet) and flood-capped.
 */
export async function reportLoginFailure(email: string): Promise<void> {
  const address = email.trim().toLowerCase().slice(0, 254);
  if (!address.includes("@")) return;
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim().slice(0, 64) || null;
    const ua = h.get("user-agent")?.slice(0, 512) ?? null;
    const supabase = await supabaseServer();
    await supabase.rpc("record_login_failure", { p_email: address, p_ip: ip, p_user_agent: ua });
  } catch {
    // best effort: a failed report must never turn into a login error
  }
}
