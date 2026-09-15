"use server";
// The one entry the Share Workout button uses when the page did not already
// load the session (Today's "last workout"). It takes a session id and
// nothing else — the server decides every number on the card. Nothing is
// written and nothing is stored: the PNG is made in the browser.
import { getI18n } from "@/lib/i18n/server";
import { getWorkoutShareCard } from "@/lib/share-card-data";
import type { WorkoutShareCard } from "@/lib/share-card";
import type { ActionResult } from "./actions";

export type ShareCardResult = ActionResult & { card?: WorkoutShareCard };

export async function loadWorkoutShareCard(sessionId: string): Promise<ShareCardResult> {
  const card = await getWorkoutShareCard(sessionId);
  if (!card) {
    const { t } = await getI18n();
    return { ok: false, message: t.common.shareCard.notFound };
  }
  return { ok: true, card };
}
