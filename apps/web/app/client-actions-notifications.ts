"use server";
// Notification reads and the mark-read writes. Marking one read is not the
// same as marking all of them.
import { revalidatePath } from "next/cache";
import { liveUser } from "@/lib/supabase/server";
import { getNotificationPage, type NotificationPage } from "@/lib/notifications-data";
import type { ActionResult } from "./actions";
import { notSignedIn } from "@/lib/action-result";



/**
 * Mark ONE notification read — what opening it does.
 *
 * Deliberately separate from the mark-all below: a bell that empties itself
 * because the panel was opened loses the one thing an unread state is for.
 * Reading a notification is an interaction; glancing at the list is not.
 *
 * `user_id = auth.uid()` is belt to the policy's braces: notifications_mark_read
 * already restricts the update to the owner, so a forged id touches no rows.
 */
export async function markNotificationRead(notificationId: string): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  revalidatePath("/notifications");
  return { ok: true };
}



/**
 * Mark every unread notification read — the explicit "mark all as read"
 * button, never something a render does on its own.
 */
export async function markNotificationsRead(): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { supabase, userId } = live;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  // Not mutated(): zero rows here means "nothing was unread", the ordinary case
  // when the panel is opened twice, not a write an RLS policy silently ate.
  if (error) return { ok: false, message: error.message };
  // The bell is rendered by the three shells, so the whole layout tree has to
  // be re-read — a path revalidation alone would leave the coach and admin
  // copies showing the count they were rendered with.
  revalidatePath("/", "layout");
  revalidatePath("/notifications");
  revalidatePath("/today");
  return { ok: true };
}



/** One more page of the notifications center, older than the last row shown. */
export async function loadNotifications(before: string | null, unreadOnly = false): Promise<NotificationPage> {
  const live = await liveUser();
  if (!live) return { items: [], next_cursor: null };
  return getNotificationPage({ before, unreadOnly });
}
