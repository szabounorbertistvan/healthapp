"use server";
// The person's marketplace email switches (docs/MARKETPLACE_EMAIL.md §6).
//
//   saveEmailPref   users.notification_prefs.email.<category> = true | false
//
// The dispatcher reads them at send time through emailCategoryEnabled(), so a
// switch flipped here applies to every email not yet sent, queued ones included.
import { revalidatePath } from "next/cache";
import { isEmailPrefCategory, withEmailPref } from "@healthapp/shared";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { notSignedIn } from "@/lib/action-result";
import type { ActionResult } from "./actions";

export async function saveEmailPref(category: string, on: boolean): Promise<ActionResult> {
  if (!isEmailPrefCategory(category) || typeof on !== "boolean") {
    return { ok: false, message: "Unknown email category" };
  }
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // Read, then write the whole column: the top-level keys are the push
  // switches and must come back untouched. Only the owner writes this row.
  const { data, error } = await supabase.from("users").select("notification_prefs").eq("id", userId).single();
  if (error || !data) return { ok: false, message: error?.message ?? "Could not read your preferences" };
  const failed = await mutated(
    await supabase
      .from("users")
      .update({ notification_prefs: withEmailPref(data.notification_prefs, category, on) }, { count: "exact" })
      .eq("id", userId),
  );
  if (failed) return failed;
  revalidatePath("/account");
  revalidatePath("/settings");
  return { ok: true };
}
