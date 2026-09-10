"use server";
import { revalidatePath } from "next/cache";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import type { RpcErrorCode } from "@healthapp/api";

// `errorCode`, not `code`: createInvite below returns the *invite* code in a
// field of its own, and one name for two meanings is how a screen ends up
// showing an error where a coach expected something to hand their client.
export type ActionResult = {
  ok: boolean;
  demo?: boolean;
  message?: string;
  errorCode?: RpcErrorCode;
};

export async function createInvite(): Promise<ActionResult & { code?: string }> {
  if (isDemo) return { ok: true, demo: true, code: "DEMO1234" };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("create_invite");
  if (error) return { ok: false, message: error.message };
  revalidatePath("/clients");
  return { ok: true, code: data?.[0]?.code };
}

export async function reviewCheckIn(
  checkInId: string,
  clientId: string,
  feedback: string,
): Promise<ActionResult> {
  if (isDemo) return { ok: true, demo: true };
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };

  if (feedback.trim()) {
    const { error: fbError } = await supabase.from("coach_feedback").insert({
      coach_id: auth.user.id,
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
  if (isDemo) return { ok: true, demo: true };
  if (!body.trim()) return { ok: false, message: "Empty message" };
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: auth.user.id,
    body: body.trim(),
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/messages/${conversationId}`);
  return { ok: true };
}
