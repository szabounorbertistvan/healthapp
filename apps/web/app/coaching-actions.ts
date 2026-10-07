"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { END_REASONS, PAUSE_REASONS } from "@healthapp/shared";
import { liveUser } from "@/lib/supabase/server";
import { notSignedIn } from "@/lib/action-result";
import { id, parseInput } from "@/lib/validate";
import type { ActionResult } from "./actions";
import { COACHING_ERRORS } from "@/lib/coaching";

// The coaching lifecycle's one write (20261109110000): pause, resume or end —
// coaching_transition(), which checks that the caller is the coach or the
// client of that relationship and that the move follows the lifecycle, locks
// the row, records the event and tells the other side. Nothing here decides.

export async function transitionCoaching(input: { relationshipId: string; to: "paused" | "active" | "ended"; reason?: string | null }): Promise<ActionResult> {
  const parsed = await parseInput(z.object({
    relationshipId: id,
    to: z.enum(["paused", "active", "ended"]),
    reason: z.enum([...PAUSE_REASONS, ...END_REASONS] as [string, ...string[]]).nullable().optional(),
  }).strict(), input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("coaching_transition", {
    p_relationship: parsed.data.relationshipId, p_to: parsed.data.to, p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    const code = COACHING_ERRORS.find((c) => error.message.includes(c));
    return code ? { ok: false, errorCode: code, message: code } : { ok: false, message: error.message };
  }
  // both sides' screens, and every coach page CTA that reads the relationship
  for (const p of ["/coach", "/clients", "/marketplace", "/today", "/coaches/requests", "/requests"]) revalidatePath(p);
  revalidatePath("/clients", "layout");
  revalidatePath("/coaches", "layout");
  return { ok: true };
}
