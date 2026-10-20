"use server";
// A coach's own check-in questions (20261207120000): add, switch on/off,
// delete one nobody answered yet. The 12-active cap, the "answered questions
// keep their kind and are deactivated, not deleted" rules and who may target
// which client are the database's (check_in_questions_guard, the policies);
// this file turns their refusals into codes the screen can say.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { notSignedIn } from "@/lib/action-result";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { id, parseInput, text } from "@/lib/validate";
import type { ActionResult } from "./actions";

const AddInput = z.object({
  prompt: text(200).min(1),
  kind: z.enum(["scale", "number", "yes_no", "text"]),
  /** null = every client of mine */
  clientId: id.nullable(),
});

function refused(message: string): ActionResult {
  if (message.includes("CHECK_IN_QUESTION_LIMIT")) return { ok: false, message: "LIMIT" };
  if (message.includes("CHECK_IN_QUESTION_ANSWERED")) return { ok: false, message: "ANSWERED" };
  return { ok: false, message };
}

function touched() {
  revalidatePath("/check-ins");
  revalidatePath("/check-in");
}

export async function addCheckInQuestion(input: z.input<typeof AddInput>): Promise<ActionResult> {
  const parsed = await parseInput(AddInput, input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { count } = await supabase.from("check_in_questions").select("id", { count: "exact", head: true }).eq("coach_id", userId);
  const { error } = await supabase.from("check_in_questions").insert({
    coach_id: userId, client_id: parsed.data.clientId, prompt: parsed.data.prompt.trim(), kind: parsed.data.kind,
    position: Math.min(100, count ?? 0),
  });
  if (error) return refused(error.message);
  touched();
  return { ok: true };
}

export async function setCheckInQuestionActive(questionId: string, active: boolean): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, z.boolean()]), [questionId, active]);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const res = await live.supabase.from("check_in_questions").update({ active: parsed.data[1] }, { count: "exact" })
    .eq("id", parsed.data[0]).eq("coach_id", live.userId);
  if (res.error) return refused(res.error.message);
  const failed = await mutated(res);
  if (failed) return failed;
  touched();
  return { ok: true };
}

export async function deleteCheckInQuestion(questionId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, questionId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const res = await live.supabase.from("check_in_questions").delete({ count: "exact" }).eq("id", parsed.data).eq("coach_id", live.userId);
  if (res.error) return refused(res.error.message);
  const failed = await mutated(res);
  if (failed) return failed;
  touched();
  return { ok: true };
}
