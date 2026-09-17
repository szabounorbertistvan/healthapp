"use server";
import { revalidatePath } from "next/cache";
import { liveUser, supabaseServer } from "@/lib/supabase/server";
import { notSignedIn } from "@/lib/action-result";
import type { RpcErrorCode } from "@healthapp/api";

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
 * from the invite RPCs, the profile-completion checks, and `mutated()`'s
 * "RLS let the write through with zero rows". A union rather than `string` so
 * a screen comparing against a misspelt code fails to compile.
 */
export type ActionErrorCode = RpcErrorCode | ProfileErrorCode | "NO_ROWS";
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
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/messages/${conversationId}`);
  return { ok: true };
}
