import "server-only";
import { liveUser } from "./supabase/server";

/**
 * In-app notifications.
 *
 * The rows have been produced since August by two pg_cron jobs —
 * detect_streak_risk() at 19:00 local and detect_checkin_due() at 09:00 on the
 * client's check-in weekday — and until now nothing in the app read the table,
 * so the whole catalog was written and never delivered.
 *
 * They are service-role writes: `notifications` has no insert policy, only a
 * select and an update for the owner (rls.sql), which is why this module reads
 * and marks read but never creates.
 */
export type NotificationRow = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  /** Where the notification points, from payload.screen — "today", "check-in"… */
  href: string | null;
  created_at: string;
  read: boolean;
};

/** Deep-link targets the catalog uses, mapped to the routes that exist today. */
const SCREEN_HREF: Record<string, string> = {
  today: "/today",
  workout: "/workout",
  nutrition: "/food",
  food: "/food",
  check_in: "/check-in",
  "check-in": "/check-in",
  progress: "/progress",
  streak: "/streak",
  habits: "/habits",
  messages: "/coach",
  coach: "/coach",
  feed: "/feed",
  challenges: "/challenges",
};

export async function getMyNotifications(limit = 20): Promise<NotificationRow[]> {
  const live = await liveUser();
  if (!live) return [];
  const { supabase, userId } = live;
  const { data, error } = await supabase
    .from("notifications")
    .select("id, category, title, body, payload, created_at, read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  // An empty bell and a failed read look identical on screen, so the failure
  // says so in the log rather than passing for "nothing new".
  if (error) console.error("notifications read failed:", error.message);

  type Row = {
    id: string; category: string; title: string; body: string | null;
    payload: { screen?: string } | null; created_at: string; read_at: string | null;
  };
  return ((data ?? []) as Row[]).map((n) => ({
    id: n.id,
    category: n.category,
    title: n.title,
    body: n.body,
    // An unknown screen becomes null rather than a broken link: the catalog is
    // written in SQL and can name a route the web app has not built yet.
    href: (n.payload?.screen && SCREEN_HREF[n.payload.screen]) || null,
    created_at: n.created_at,
    read: n.read_at !== null,
  }));
}

/** Just the badge number — a head request, no rows over the wire. */
export async function getUnreadNotificationCount(): Promise<number> {
  const live = await liveUser();
  if (!live) return 0;
  const { supabase, userId } = live;
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) console.error("notification count failed:", error.message);
  return count ?? 0;
}
