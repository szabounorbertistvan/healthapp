"use server";
import { revalidatePath } from "next/cache";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { notSignedIn, type PlanErrorCode } from "@/lib/action-result";
import type { RpcErrorCode } from "@healthapp/api";
import type { CoachProfileErrorCode } from "@/lib/coach-profile";
import type { BookingErrorCode } from "@/lib/booking";
import type { ReviewErrorCode } from "@/lib/coach-review";

// `errorCode`, not `code`: createInvite below returns the *invite* code in a
// field of its own, and one name for two meanings is how a screen ends up
// showing an error where a coach expected something to hand their client.
export type ActionResult = {
  ok: boolean;
  message?: string;
  errorCode?: ActionErrorCode;
};

/**
 * Every business code an action can hand a screen: the ones Postgres raises
 * from the invite RPCs, the profile-completion checks, `mutated()`'s
 * "RLS let the write through with zero rows", and `parseInput()`'s "the
 * arguments are not the shape this action takes". A union rather than `string` so
 * a screen comparing against a misspelt code fails to compile.
 */
export type ActionErrorCode =
  | RpcErrorCode | ProfileErrorCode | PlanErrorCode | CoachProfileErrorCode | BookingErrorCode | ReviewErrorCode | "NO_ROWS" | "INVALID_INPUT";
export type ProfileErrorCode =
  | "NAME" | "USERNAME_FORMAT" | "SEX" | "AGE" | "USERNAME_TAKEN" | "ROLE" | "CITY" | "BIO";

export async function createInvite(): Promise<ActionResult & { code?: string }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("create_invite");
  if (error) {
    // The screen shows business codes only, so this is the one place the real
    // cause is recoverable when the RPC fails for an infrastructure reason.
    console.error("create_invite failed:", error.message);
    return { ok: false, message: error.message };
  }
  revalidatePath("/clients");
  return { ok: true, code: data?.[0]?.code };
}

export async function reviewCheckIn(
  checkInId: string,
  clientId: string,
  feedback: string,
): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;

  if (feedback.trim()) {
    const { error: fbError } = await supabase.from("coach_feedback").insert({
      coach_id: userId,
      client_id: clientId,
      reference_type: "check_in",
      reference_id: checkInId,
      body: feedback.trim(),
    });
    if (fbError) return { ok: false, message: fbError.message };
  }
  const { error } = await supabase
    .from("check_ins")
    .update({ coach_reviewed_at: new Date().toISOString() })
    .eq("id", checkInId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/check-ins");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function sendMessage(conversationId: string, body: string): Promise<ActionResult> {
  if (!body.trim()) return { ok: false, message: "Empty message" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: userId,
    body: body.trim(),
  });
  // msg_insert asks conversation_open() (20261104100000): a block, a
  // suspension, a pending deletion, an ended relationship or a request that
  // is no longer accepted all land here as an RLS refusal.
  if (error?.code === "42501") return { ok: false, errorCode: "CONVERSATION_CLOSED", message: "CONVERSATION_CLOSED" };
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/messages/${conversationId}`);
  revalidatePath(`/coach/messages/${conversationId}`);
  return { ok: true };
}

/**
 * Opening a thread reads it: the other side's messages get read_at, and the
 * conversation's new_message notice is read with them (mark_conversation_read).
 * Called by the thread once it is on screen, never by a render.
 */
export async function markConversationRead(conversationId: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("mark_conversation_read", { p_conversation: conversationId });
  if (error) return { ok: false, message: error.message };
  // Only when something changed: the unread badges and the bell live in the layouts.
  if ((data ?? 0) > 0) revalidatePath("/", "layout");
  return { ok: true };
}
