"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { adminActor } from "@/lib/admin/guard";
import { uuidOf } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import type { ActionResult } from "./actions";

/**
 * /admin/coaches writes: the review decisions on a coach profile. Same
 * contract as admin-actions.ts — one RPC each, admin_set_coach_profile_status(),
 * which re-checks is_admin() in SQL, allows only the lifecycle's transitions
 * (20261029100000), requires a reason where the coach needs one, and writes
 * its own audit row. Hide / show are not here: they are the coach's switch.
 */
async function setStatus(profileId: string, status: "published" | "draft" | "suspended", reason = ""): Promise<ActionResult> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  const id = uuidOf(profileId);
  if (!id) return { ok: false, message: "Invalid id" };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_set_coach_profile_status", {
    p_profile: id, p_status: status, p_reason: reason.trim().slice(0, 1000) || null,
  });
  if (error) {
    const { t } = await getI18n();
    const known = t.admin.coaches.errors;
    const code = (Object.keys(known) as (keyof typeof known)[]).find((k) => error.message.includes(k));
    return { ok: false, message: code ? known[code] : error.message };
  }
  // the queue, the review page, discovery and every coach page (the slug is not known here)
  revalidatePath("/admin/coaches", "layout");
  revalidatePath("/coaches", "layout");
  revalidatePath("/settings", "layout");
  return { ok: true };
}

/** pending_review → published. Never verifies: badges are admin_set_coach_verification(), separately. */
export async function approveCoachProfile(profileId: string): Promise<ActionResult> {
  return setStatus(profileId, "published");
}

/** pending_review | published | hidden → draft, with the note the coach will see. */
export async function returnCoachProfileToDraft(profileId: string, reason: string): Promise<ActionResult> {
  return setStatus(profileId, "draft", reason);
}

export async function suspendCoachProfile(profileId: string, reason: string): Promise<ActionResult> {
  return setStatus(profileId, "suspended", reason);
}

/** suspended → published or draft. */
export async function restoreCoachProfile(profileId: string, to: "published" | "draft"): Promise<ActionResult> {
  return setStatus(profileId, to);
}

// ---------- verification (20261101100000) ----------

/**
 * The Voinic verification decision: pending → verified | rejected,
 * rejected → pending, verified → rejected (revoke). A rejection needs the
 * reason the coach will read. admin_set_coach_verification_status() re-checks
 * is_admin(), allows only these moves, and audits each one.
 */
export async function setCoachVerification(
  profileId: string, status: "verified" | "rejected" | "pending", note = "",
): Promise<ActionResult> {
  return adminRpc("admin_set_coach_verification_status", {
    p_profile: uuidOf(profileId), p_status: status, p_note: note.trim().slice(0, 1000) || null,
  });
}

/** One credential: verified by Voinic, or not accepted (with a note). Never set by the coach. */
export async function setCredentialStatus(
  certificationId: string, status: "verified" | "rejected" | "pending", note = "",
): Promise<ActionResult> {
  return adminRpc("admin_set_certification_status", {
    p_certification: uuidOf(certificationId), p_status: status, p_note: note.trim().slice(0, 1000) || null,
  });
}

async function adminRpc(name: string, args: Record<string, unknown>): Promise<ActionResult> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  if (Object.values(args).some((v, i) => i === 0 && !v)) return { ok: false, message: "Invalid id" };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc(name, args);
  if (error) {
    const { t } = await getI18n();
    const known = t.admin.coaches.errors;
    const code = (Object.keys(known) as (keyof typeof known)[]).find((k) => error.message.includes(k));
    return { ok: false, message: code ? known[code] : error.message };
  }
  revalidatePath("/admin/coaches", "layout");
  revalidatePath("/coaches", "layout");
  revalidatePath("/settings", "layout");
  return { ok: true };
}
