"use server";
// Join and leave a challenge. Progress is never written — it is derived from
// logged sessions at read time (lib/challenges-data.ts) — so these are the
// only two writes the feature has, plus the completed_at stamp the reads make.
import { revalidatePath } from "next/cache";
import { canJoin } from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";
import { isoDay } from "@/lib/dates";

function touched(id: string) {
  revalidatePath("/challenges");
  revalidatePath(`/challenges/${id}`);
  revalidatePath("/today");
}

export async function joinChallenge(id: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // RLS (participants_join) refuses an ended challenge too; checking here
  // gives the person a translated reason instead of a policy error.
  const { data: ch } = await supabase.from("challenges").select("start_date, end_date").eq("id", id).maybeSingle();
  if (!ch) return { ok: false, message: t.common.challenges.notFound };
  if (!canJoin(ch, isoDay())) return { ok: false, message: t.common.challenges.endedCannotJoin };
  const { error } = await supabase
    .from("challenge_participants")
    .upsert({ challenge_id: id, user_id: userId }, { onConflict: "challenge_id,user_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: error.message };
  touched(id);
  return { ok: true };
}

export async function leaveChallenge(id: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const result = await supabase
    .from("challenge_participants")
    .delete({ count: "exact" })
    .eq("challenge_id", id)
    .eq("user_id", userId);
  const failure = await mutated(result);
  if (failure) return failure;
  touched(id);
  return { ok: true };
}
