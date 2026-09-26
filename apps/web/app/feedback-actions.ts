"use server";
import { headers } from "next/headers";
import { liveUser } from "@/lib/supabase/server";
import { notSignedIn } from "@/lib/action-result";
import { getLocale } from "@/lib/i18n/server";
import type { ActionResult } from "./actions";

export type FeedbackKind = "bug" | "idea" | "other";

/**
 * A bug report or a suggestion from the feedback dialog. One RPC,
 * submit_feedback() (20260924100000_feedback.sql), which stamps the author and
 * caps each account at ten an hour. Only an admin ever reads the rows, on
 * /admin/feedback. `reason` lets the dialog say which refusal it was.
 */
export async function sendFeedback(
  kind: FeedbackKind,
  message: string,
  route: string | null,
): Promise<ActionResult & { reason?: "rate" | "empty" }> {
  const text = message.trim().slice(0, 4000);
  if (!text) return { ok: false, reason: "empty" };
  if (kind !== "bug" && kind !== "idea" && kind !== "other") return { ok: false, message: "Invalid kind" };
  const live = await liveUser();
  if (!live) return notSignedIn;

  const h = await headers();
  const { error } = await live.supabase.rpc("submit_feedback", {
    p_kind: kind,
    p_message: text,
    p_route: route?.slice(0, 300) ?? null,
    p_user_agent: h.get("user-agent")?.slice(0, 512) ?? null,
    p_locale: await getLocale(),
  });
  if (error) {
    if (error.message.includes("FEEDBACK_RATE")) return { ok: false, reason: "rate" };
    if (error.message.includes("FEEDBACK_EMPTY")) return { ok: false, reason: "empty" };
    console.error("[feedback] submit_feedback failed:", error.message);
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
