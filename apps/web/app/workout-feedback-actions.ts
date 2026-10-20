"use server";
// A coach's comment on a client's workout or on one set (20261207110000).
// The database checks the rest: the writer is the client's active coach
// (feedback_coach_insert), the session or set is that client's
// (coach_feedback_guard), and the client is notified (coach_feedback_notify).
// A comment can be taken back within a day (feedback_coach_delete).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { notSignedIn } from "@/lib/action-result";
import { liveUser } from "@/lib/supabase/server";
import { inserted, mutated } from "@/lib/supabase/mutate";
import { id, parseInput, text } from "@/lib/validate";
import type { ActionResult } from "./actions";

const AddInput = z.object({
  clientId: id,
  referenceType: z.enum(["session", "set"]),
  referenceId: id,
  body: text(2000).min(1),
});

export async function addWorkoutFeedback(input: z.input<typeof AddInput>): Promise<ActionResult> {
  const parsed = await parseInput(AddInput, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.from("coach_feedback").insert({
    coach_id: live.userId, client_id: v.clientId, reference_type: v.referenceType, reference_id: v.referenceId, body: v.body.trim(),
  });
  if (error?.message.includes("FEEDBACK_REFERENCE")) return { ok: false, errorCode: "INVALID_INPUT" };
  const failed = await inserted(error);
  if (failed) return failed;
  revalidatePath(`/clients/${v.clientId}`);
  return { ok: true };
}

export async function deleteWorkoutFeedback(feedbackId: string, clientId: string): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, id]), [feedbackId, clientId]);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const failed = await mutated(
    await live.supabase.from("coach_feedback").delete({ count: "exact" }).eq("id", parsed.data[0]).eq("coach_id", live.userId),
  );
  if (failed) return failed;
  revalidatePath(`/clients/${parsed.data[1]}`);
  return { ok: true };
}
