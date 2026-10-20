"use server";
// One action, several clients: the coach picks clients on /clients and sends
// them the same message, gives them the same habit, or copies them the same
// program. Each client is a separate write through the same policies as the
// single-client path (msg_insert / conversation_open, habits_coach,
// copy_program), so nothing here can reach a client the coach does not
// actively coach — a refused client is counted, never silently dropped.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { notSignedIn, upgradeRequired } from "@/lib/action-result";
import { liveUser } from "@/lib/supabase/server";
import { getPlan } from "@/lib/plan";
import { id, parseInput, text } from "@/lib/validate";
import type { ActionResult } from "./actions";

const Base = z.object({ clientIds: z.array(id).min(1).max(50) });
const BulkInput = z.discriminatedUnion("kind", [
  Base.extend({ kind: z.literal("message"), body: text(4000).min(1) }),
  Base.extend({
    kind: z.literal("habit"),
    name: text(80).min(1),
    /** 0 = Sunday … 6 = Saturday, the habits table's convention. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  Base.extend({ kind: z.literal("program"), programId: id }),
]);

export type BulkResult = ActionResult & { done?: number; failed?: number };

export async function bulkClientAction(input: z.input<typeof BulkInput>): Promise<BulkResult> {
  const parsed = await parseInput(BulkInput, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const clientIds = [...new Set(v.clientIds)];
  if (v.kind === "program" && !(await getPlan()).e.programCopy) return upgradeRequired;

  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  let done = 0;
  let failed = 0;

  if (v.kind === "message") {
    const { data: convs, error } = await supabase
      .from("conversations")
      .select("id, client_id")
      .eq("coach_id", userId)
      .in("client_id", clientIds);
    if (error) return { ok: false, message: error.message };
    const byClient = new Map((convs ?? []).map((c) => [c.client_id as string, c.id as string]));
    for (const clientId of clientIds) {
      const conversationId = byClient.get(clientId);
      if (!conversationId) { failed++; continue; }
      const { error: e } = await supabase.from("messages").insert({ conversation_id: conversationId, sender_id: userId, body: v.body.trim() });
      if (e) failed++; else done++;
    }
    revalidatePath("/messages");
  } else if (v.kind === "habit") {
    const weekdays = [...new Set(v.weekdays)].sort();
    for (const clientId of clientIds) {
      const { error: e } = await supabase.from("habits").insert({
        user_id: clientId, created_by: userId, name: v.name.trim(), weekdays, active: true,
      });
      if (e) failed++; else done++;
    }
  } else {
    for (const clientId of clientIds) {
      const { error: e } = await supabase.rpc("copy_program", { p_source: v.programId, p_name: null, p_for_client: clientId });
      if (e) failed++; else done++;
    }
    revalidatePath("/programs");
  }

  revalidatePath("/clients");
  return { ok: done > 0, done, failed, ...(done === 0 ? { errorCode: "NO_ROWS" } : {}) };
}
