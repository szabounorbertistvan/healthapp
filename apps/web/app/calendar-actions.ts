"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { liveUser } from "@/lib/supabase/server";
import { notSignedIn } from "@/lib/action-result";
import { id, parseInput } from "@/lib/validate";
import type { ActionResult } from "./actions";

// External calendars (20261111130000): the coach's two moves. Both are RPCs
// that check ownership themselves (NOT_FOUND for anyone else's connection);
// nothing here sees a token. Connecting is not here: it needs a provider's
// OAuth callback, which does not exist yet (lib/calendar/provider.ts).

function done(error: { message: string; code?: string } | null): ActionResult {
  if (error) {
    if (/NOT_FOUND/.test(error.message)) return { ok: false, errorCode: "NOT_FOUND", message: "NOT_FOUND" };
    console.error("calendar write failed:", error.message);
    return { ok: false, message: error.message };
  }
  revalidatePath("/bookings/availability");
  return { ok: true };
}

/** Whether one of my calendars blocks my booking times. Off drops its busy time at once; on asks for a sync. */
export async function setCalendarSourceAvailability(sourceId: string, on: boolean): Promise<ActionResult> {
  const parsed = await parseInput(z.tuple([id, z.boolean()]), [sourceId, on]);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("calendar_set_source_availability", { p_source: parsed.data[0], p_on: parsed.data[1] });
  return done(error);
}

/** Disconnect: the calendar stops affecting availability now; its token is revoked by the worker and purged within 7 days. */
export async function disconnectCalendar(connectionId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, connectionId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { error } = await live.supabase.rpc("calendar_disconnect", { p_connection: parsed.data });
  return done(error);
}
