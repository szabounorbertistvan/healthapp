"use server";
// Join and leave a challenge. Progress is never written — it is derived from
// logged sessions at read time (lib/challenges-data.ts) — so these are the
// only two writes the feature has, plus the completed_at stamp the reads make.
import { revalidatePath } from "next/cache";
import { canJoin } from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { isDemo, supabaseServer } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { viewingClientId } from "@/lib/view-mode";
import { clientStore, isoDay, newId } from "@/lib/demo-client-store";
import type { ActionResult } from "./actions";

function touched(id: string) {
  revalidatePath("/challenges");
  revalidatePath(`/challenges/${id}`);
  revalidatePath("/today");
}

export async function joinChallenge(id: string): Promise<ActionResult> {
  const { t } = await getI18n();
  if (isDemo) {
    const userId = await viewingClientId();
    const cs = clientStore();
    const ch = cs.challenges.find((c) => c.id === id);
    if (!ch) return { ok: false, message: t.common.challenges.notFound };
    if (!canJoin(ch, isoDay())) return { ok: false, message: t.common.challenges.endedCannotJoin };
    if (!cs.participants.some((p) => p.challenge_id === id && p.user_id === userId)) {
      cs.participants.push({ id: newId("cp"), challenge_id: id, user_id: userId, joined_at: new Date().toISOString(), completed_at: null });
    }
    touched(id);
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  // RLS (participants_join) refuses an ended challenge too; checking here
  // gives the person a translated reason instead of a policy error.
  const { data: ch } = await supabase.from("challenges").select("start_date, end_date").eq("id", id).maybeSingle();
  if (!ch) return { ok: false, message: t.common.challenges.notFound };
  if (!canJoin(ch, isoDay())) return { ok: false, message: t.common.challenges.endedCannotJoin };
  const { error } = await supabase
    .from("challenge_participants")
    .upsert({ challenge_id: id, user_id: auth.user.id }, { onConflict: "challenge_id,user_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: error.message };
  touched(id);
  return { ok: true };
}

export async function leaveChallenge(id: string): Promise<ActionResult> {
  if (isDemo) {
    const userId = await viewingClientId();
    const cs = clientStore();
    const index = cs.participants.findIndex((p) => p.challenge_id === id && p.user_id === userId);
    if (index >= 0) cs.participants.splice(index, 1);
    touched(id);
    return { ok: true, demo: true };
  }
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Not signed in" };
  const result = await supabase
    .from("challenge_participants")
    .delete({ count: "exact" })
    .eq("challenge_id", id)
    .eq("user_id", auth.user.id);
  const failure = await mutated(result);
  if (failure) return failure;
  touched(id);
  return { ok: true };
}
