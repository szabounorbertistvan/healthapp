import "server-only";
import { postPhotoOf, type PostPayload } from "@healthapp/shared";
import { liveUser } from "./supabase/server";
import {
  challengeNotice, notificationActorId, notificationHref, notificationPostId, notificationSentence, parseNotificationCursor,
  type NotificationSentence,
} from "./notification-href";

/** What the thumbnail says about a post without a photo: the workout's name, the PR's exercise, the caption. */
function postLabel(p: { type: string; text: string | null; payload: PostPayload | null }): string | null {
  const payload = p.payload;
  if (payload?.kind === "workout") return payload.name;
  if (payload?.kind === "pr") return payload.exercise;
  if (payload?.kind === "program") return payload.name;
  return p.text ? p.text.slice(0, 60) : null;
}

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
  /**
   * The post a social row points at, for the thumbnail on the right: its
   * photo when it has one, otherwise its kind and a short label (the
   * workout's name, the PR's exercise, the caption). Null for an engine row
   * or a post since deleted.
   */
  post: { id: string; type: string; label: string | null; photo_url: string | null } | null;
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
  const { supabase } = live;
  const limit = Math.max(1, Math.min(opts.limit ?? NOTIFICATION_PAGE_SIZE, 50));
  const before = parseNotificationCursor(opts.before);

  // social_notification_feed (20261008100000): rows, actors and snippets in
  // one round trip. The snippet is the comment or caption as it is NOW and
  // only while the reader may see it; an actor hidden from the reader (block,
  // suspension, deletion) comes back as null.
  const { data, error } = await supabase.rpc("social_notification_feed", {
    p_limit: limit + 1,
    p_before_at: before?.at ?? null,
    p_before_id: before?.id ?? null,
    p_unread_only: Boolean(opts.unreadOnly),
  });
  if (error) {
    // PGRST202: the function is not there yet — a database without the
    // migration. Read the table directly, as before it.
    if (error.code === "PGRST202") return legacyNotificationPage(opts);
    console.error("notifications read failed:", error.message);
    return { items: [], next_cursor: null };
  }
  type FeedRow = {
    id: string; category: string; title: string; snippet: string | null;
    payload: Record<string, unknown> | null; created_at: string; read_at: string | null;
    actor_id: string | null; actor_name: string | null; actor_username: string | null; actor_avatar: string | null;
  };
  const rows = (data ?? []) as FeedRow[];
  const page = rows.slice(0, limit);
  const posts = await notificationPosts(supabase, page);
  const items = page.map((n) => toRow(n, {
    body: n.snippet,
    actor: n.actor_id && n.actor_name
      ? { id: n.actor_id, name: n.actor_name, username: n.actor_username, avatar_url: n.actor_avatar }
      : null,
    posts,
  }));
  const last = items[items.length - 1];
  return { items, next_cursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null };
}

type Supabase = NonNullable<Awaited<ReturnType<typeof liveUser>>>["supabase"];

/**
 * The posts the rows point at, for the thumbnail. They are the reader's own
 * (a reaction, a comment or a mention on your post) or ones you may see (a
 * mention in a comment), so posts_select answers directly — one query for
 * the page, never one per card.
 */
async function notificationPosts(
  supabase: Supabase,
  page: { payload: Record<string, unknown> | null }[],
): Promise<Map<string, NotificationRow["post"]>> {
  const posts = new Map<string, NotificationRow["post"]>();
  const postIds = [...new Set(page.map((n) => notificationPostId(n.payload)).filter((id): id is string => Boolean(id)))];
  if (postIds.length === 0) return posts;
  type Post = { id: string; type: string; text: string | null; payload: PostPayload | null };
  const { data } = await supabase.from("social_posts").select("id, type, text, payload").in("id", postIds).is("deleted_at", null);
  for (const p of ((data ?? []) as Post[])) posts.set(p.id, { id: p.id, type: p.type, label: postLabel(p), photo_url: postPhotoOf(p.payload)?.url ?? null });
  return posts;
}

/** One notification row as the card wants it. */
function toRow(
  n: { id: string; category: string; title: string; payload: Record<string, unknown> | null; created_at: string; read_at: string | null },
  extra: { body: string | null; actor: NotificationRow["actor"]; posts: Map<string, NotificationRow["post"]> },
): NotificationRow {
  const postId = notificationPostId(n.payload);
  return {
    id: n.id,
    category: n.category,
    sentence: notificationSentence(n.category, n.payload),
    title: n.title,
    body: extra.body,
    href: notificationHref(n.category, n.payload),
    created_at: n.created_at,
    read: n.read_at !== null,
    actor: extra.actor,
    badge: typeof n.payload?.name_en === "string"
      ? { en: n.payload.name_en, ro: typeof n.payload.name_ro === "string" ? n.payload.name_ro : n.payload.name_en }
      : null,
    challenge: n.category === "challenge_milestone" ? challengeNotice(n.payload) : null,
    post: postId ? extra.posts.get(postId) ?? null : null,
  };
}

/**
 * The read from before 20261008100000: the table directly (RLS keeps it to
 * the reader's own rows) and one RPC for every actor on the page. Kept only
 * so the page works against a database the migration has not reached yet.
 */
async function legacyNotificationPage(
  opts: { before?: string | null; unreadOnly?: boolean; limit?: number },
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
  // The post thumbnails go in the same wave as the actors.
  const [posts] = await Promise.all([
    notificationPosts(supabase, page),
    (async () => {
      if (actorIds.length === 0) return;
      const { data: people } = await supabase.rpc("notification_actors", { p_ids: actorIds });
      for (const person of ((people ?? []) as Actor[])) actors.set(person.id, person);
    })(),
  ]);

  const items = page.map((n) => {
    const actorId = notificationActorId(n.payload);
    return toRow(n, { body: n.body, actor: actorId ? actors.get(actorId) ?? null : null, posts });
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
