"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { adminActor } from "@/lib/admin/guard";
import { uuidOf } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import type { ActionResult } from "./actions";

/**
 * /admin/reports writes (20261110110000): close a report — and, by default,
 * every open report of the same thing — as resolved ("reviewed") or
 * dismissed. One RPC, admin_resolve_report(), which re-checks the admin in
 * SQL and writes the audit row. Acting on the content itself (hide a review,
 * suspend a profile) lives on that content's own page and closes its reports.
 */
async function resolve(reportId: string, status: "reviewed" | "dismissed", note: string): Promise<ActionResult> {
  if (!(await adminActor())) return { ok: false, message: "Admins only" };
  const id = uuidOf(reportId);
  if (!id) return { ok: false, message: "Invalid id" };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("admin_resolve_report", {
    p_report: id, p_status: status, p_note: note.trim().slice(0, 1000) || null, p_all_for_target: true,
  });
  if (error) {
    const { t } = await getI18n();
    const known = t.admin.reports.errors;
    const code = (Object.keys(known) as (keyof typeof known)[]).find((k) => error.message.includes(k));
    return { ok: false, message: code ? known[code] : error.message };
  }
  revalidatePath("/admin/reports");
  revalidatePath("/admin/coaches", "layout");
  return { ok: true };
}

export async function resolveReport(reportId: string, note: string): Promise<ActionResult> {
  return resolve(reportId, "reviewed", note);
}

export async function dismissReport(reportId: string, note: string): Promise<ActionResult> {
  return resolve(reportId, "dismissed", note);
}
