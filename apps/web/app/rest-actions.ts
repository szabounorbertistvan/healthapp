"use server";
// Writes behind the rest timer. The timer itself never waits on any of
// these: a set is logged and the countdown starts whether or not the push
// schedule below can be reached — see the split in lib/rest-timer/client.tsx.
//
//   saveRestPrefs          users.rest_prefs — default, per-lift overrides, notify
//   savePushSubscription   this browser's Web Push endpoint + keys
//   removePushSubscription forget it (notifications switched off)
//   scheduleRestPush       one rest_pushes row per rest, keyed by the timer id
//   cancelRestPush         paused, skipped, or finished in the foreground
import { revalidatePath } from "next/cache";
import { normalizeRestPrefs, REST_MAX_SECONDS, REST_MIN_SECONDS, type RestPrefs } from "@healthapp/shared";
import { getI18n } from "@/lib/i18n/server";
import { liveUser } from "@/lib/supabase/server";
import { mutated } from "@/lib/supabase/mutate";
import { notSignedIn } from "@/lib/action-result";
import type { ActionResult } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How far ahead a rest may be scheduled — a timer is minutes, never hours. */
const MAX_LEAD_MS = 2 * 60 * 60 * 1000;

export async function saveRestPrefs(input: RestPrefs): Promise<ActionResult> {
  const prefs = normalizeRestPrefs(input);
  if (prefs.default_seconds < REST_MIN_SECONDS || prefs.default_seconds > REST_MAX_SECONDS) {
    return { ok: false, message: "Rest must be between 5 seconds and 10 minutes" };
  }
  // Only lift ids: the column is the person's own, but a blob of arbitrary
  // keys is still not what it is for.
  const exercises: Record<string, number> = {};
  for (const [id, seconds] of Object.entries(prefs.exercises)) {
    if (UUID.test(id)) exercises[id] = seconds;
  }
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const failed = await mutated(
    await supabase
      .from("users")
      .update({ rest_prefs: { ...prefs, exercises } }, { count: "exact" })
      .eq("id", userId),
  );
  if (failed) return failed;
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<ActionResult> {
  const endpoint = input.endpoint?.trim() ?? "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2048) return { ok: false, message: "Invalid push endpoint" };
  if (!input.p256dh || input.p256dh.length > 256 || !input.auth || input.auth.length > 64) {
    return { ok: false, message: "Invalid push keys" };
  }
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // The endpoint is unique per browser; re-enabling after a key rotation
  // overwrites the row rather than stacking a dead one next to it.
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint, p256dh: input.p256dh, auth: input.auth },
      { onConflict: "endpoint" },
    );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * Ask the server to say "rest finished" at `endsAt` if the phone is asleep
 * by then. Upsert on the timer id: +15 s and resume move the same row's
 * instant instead of adding a second one, and re-arm it if the earlier end
 * had already been sent — the timer clears its own notified flag the same way.
 */
export async function scheduleRestPush(input: {
  id: string;
  endsAt: number;
  dayId: string;
  /** RestPrefs.alert, so the worker knows whether this one may reach the lock screen. */
  alert?: boolean;
}): Promise<ActionResult> {
  if (!UUID.test(input.id) || !UUID.test(input.dayId)) return { ok: false, message: "Invalid timer" };
  const endsAt = Number(input.endsAt);
  const now = Date.now();
  if (!Number.isFinite(endsAt) || endsAt < now - 60_000 || endsAt > now + MAX_LEAD_MS) {
    return { ok: false, message: "Invalid end time" };
  }
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { t } = await getI18n();
  const { error } = await supabase.from("rest_pushes").upsert(
    {
      id: input.id,
      user_id: userId,
      notify_at: new Date(endsAt).toISOString(),
      title: t.clientWidgets.restTimer.finishedTitle,
      body: t.clientWidgets.restTimer.finishedBody,
      url: `/workout/${input.dayId}/log`,
      alert: input.alert !== false,
      sent_at: null,
      cancelled_at: null,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function cancelRestPush(id: string): Promise<ActionResult> {
  if (!UUID.test(id)) return { ok: false, message: "Invalid timer" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  // No mutated() guard: a row that was already sent, or never written
  // because push was off, is not an error here.
  const { error } = await supabase
    .from("rest_pushes")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("sent_at", null);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
