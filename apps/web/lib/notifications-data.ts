import "server-only";
import { liveUser } from "./supabase/server";
import {
  challengeNotice, notificationActorId, notificationHref, notificationSentence, parseNotificationCursor, type NotificationSentence,
} from "./notification-href";

/**
 * In-app notifications.
 *
 * The rows have been produced since August by two pg_cron jobs —
 * detect_streak_risk() at 19:00 local and detect_checkin_due() at 09:00 on the
 * client's check-in weekday — and, since the social migrations, by triggers on
 * follows, kudos, comments, mentions and badge awards.
 *
 * They are service-role / trigger writes: `notifications` has no insert
 * policy, only a select and an update for the owner (rls.sql), which is why
 * this module reads and marks read but never creates.
 */
export type NotificationRow = {
  id: string;
  category: string;
  /** Which sentence the card reads as; null for an engine row with its own title. */
  sentence: NotificationSentence | null;
  title: string;
  body: string | null;
  /** Where the notification points (lib/notification-href). */
  href: string | null;
  created_at: string;
  read: boolean;
  /** Who did the thing, for the avatar on the card. Null for engine rows. */
  actor: { id: string; name: string; username: string | null; avatar_url: string | null } | null;
  /** A badge row's name in both languages, so the card reads in the reader's. */
  badge: { en: string; ro: string } | null;
  /** The step and the challenge's titles, for a challenge_milestone row. */
  challenge: { milestone: 25 | 50 | 75 | 100; en: string; ro: string } | null;
};

export const NOTIFICATION_PAGE_SIZE = 20;

export type NotificationPage = { items: NotificationRow[]; next_cursor: string | null };


/**
 * One page of the signed-in person's notifications, newest first.
 *
 * Cursor-paged on created_at like the feed: `before` is the created_at of the
 * last row already shown. `unreadOnly` narrows to what has not been read. One
 * extra row answers "is there more?" without a count, and one RPC resolves
 * every actor on the page — never a lookup per card.
 */
export async function getNotificationPage(
  opts: { before?: string | null; unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationPage> {
  const live = await liveUser();
  if (!live) return { items: [], next_cursor: null };
  const { supabase, userId } = live;
  const limit = Math.max(1, Math.min(opts.limit ?? NOTIFICATION_PAGE_SIZE, 50));

  let query = supabase
    .from("notifications")
    .select("id, category, title, body, payload, created_at, read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  const before = parseNotificationCursor(opts.before);
  if (before) query = query.or(`created_at.lt.${before.at},and(created_at.eq.${before.at},id.lt.${before.id})`);
  if (opts.unreadOnly) query = query.is("read_at", null);
  const { data, error } = await query;
  // An empty bell and a failed read look identical on screen, so the failure
  // says so in the log rather than passing for "nothing new".
  if (error) console.error("notifications read failed:", error.message);

  type Row = {
    id: string; category: string; title: string; body: string | null;
    payload: Record<string, unknown> | null; created_at: string; read_at: string | null;
  };
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, limit);

  // users_select would hide every actor who is not the reader's coach or
  // client, so names go through a definer RPC that returns name, handle and
  // avatar and nothing else.
  const actorIds = [...new Set(page.map((n) => notificationActorId(n.payload)).filter((id): id is string => Boolean(id)))];
  type Actor = { id: string; name: string; username: string | null; avatar_url: string | null };
  const actors = new Map<string, Actor>();
  if (actorIds.length > 0) {
    const { data: people } = await supabase.rpc("notification_actors", { p_ids: actorIds });
    for (const person of ((people ?? []) as Actor[])) actors.set(person.id, person);
  }

  const items = page.map((n) => {
    const actorId = notificationActorId(n.payload);
    return {
      id: n.id,
      category: n.category,
      sentence: notificationSentence(n.category, n.payload),
      title: n.title,
      body: n.body,
      href: notificationHref(n.category, n.payload),
      created_at: n.created_at,
      read: n.read_at !== null,
      actor: actorId ? actors.get(actorId) ?? null : null,
      badge: typeof n.payload?.name_en === "string"
        ? { en: n.payload.name_en, ro: typeof n.payload.name_ro === "string" ? n.payload.name_ro : n.payload.name_en }
        : null,
      challenge: n.category === "challenge_milestone" ? challengeNotice(n.payload) : null,
    };
  });
  const last = items[items.length - 1];
  return { items, next_cursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null };
}

/** The most recent notifications, for the bell's panel. */
export async function getMyNotifications(limit = 20): Promise<NotificationRow[]> {
  return (await getNotificationPage({ limit })).items;
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
