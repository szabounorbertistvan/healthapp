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
  /** Who did the thing, for the avatar on the card. Null for engine rows. */
  actor: { id: string; name: string; username: string | null; avatar_url: string | null } | null;
};

/**
 * Where a notification points.
 *
 * Two dialects share this table. The catalog in PRODUCT_SPEC §8 — the rows the
 * cron jobs write — carries `payload.screen`. The social triggers do not: kudos
 * writes `post_id`, a follow writes `follower_id` (see the kudos and following
 * migrations), so those are resolved by category instead. Anything unrecognised
 * renders as a plain row rather than a link that 404s.
 */
function hrefFor(category: string, payload: Record<string, unknown> | null): string | null {
  const postId = typeof payload?.post_id === "string" ? payload.post_id : null;
  const followerId = typeof payload?.follower_id === "string" ? payload.follower_id : null;
  const actorId = typeof payload?.actor_id === "string" ? payload.actor_id : null;

  const commentId = typeof payload?.comment_id === "string" ? payload.comment_id : null;

  if (category === "new_kudos" && postId) return `/feed/${postId}`;
  if (category === "new_follower" && (followerId ?? actorId)) return `/people/${followerId ?? actorId}`;
  // A comment, a reply and a mention all live on the post; the fragment takes
  // the reader to the exact comment rather than the top of a long thread.
  if ((category === "new_comment" || category === "comment_reply" || category === "new_mention") && postId) {
    return commentId ? `/feed/${postId}#comment-${commentId}` : `/feed/${postId}`;
  }

  const screen = typeof payload?.screen === "string" ? payload.screen : null;
  return (screen && SCREEN_HREF[screen]) || null;
}

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
    payload: Record<string, unknown> | null; created_at: string; read_at: string | null;
  };
  const rows = (data ?? []) as Row[];

  // One lookup for every actor on the page rather than one per card.
  // users_select would hide them all, so it goes through a definer RPC that
  // returns name, handle and avatar and nothing else.
  const actorIds = [...new Set(
    rows.map((n) => (typeof n.payload?.actor_id === "string" ? n.payload.actor_id
                   : typeof n.payload?.follower_id === "string" ? n.payload.follower_id : null))
      .filter((id): id is string => Boolean(id)),
  )];
  type Actor = { id: string; name: string; username: string | null; avatar_url: string | null };
  const actors = new Map<string, Actor>();
  if (actorIds.length > 0) {
    const { data: people } = await supabase.rpc("notification_actors", { p_ids: actorIds });
    for (const person of ((people ?? []) as Actor[])) actors.set(person.id, person);
  }

  return rows.map((n) => {
    const actorId = typeof n.payload?.actor_id === "string" ? n.payload.actor_id
      : typeof n.payload?.follower_id === "string" ? n.payload.follower_id : null;
    return {
      id: n.id,
      category: n.category,
      title: n.title,
      body: n.body,
      href: hrefFor(n.category, n.payload),
      created_at: n.created_at,
      read: n.read_at !== null,
      actor: actorId ? actors.get(actorId) ?? null : null,
    };
  });
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
