/**
 * The Activity Center's decisions that are not markup: what a notification
 * says, which small icon it wears, which day group it falls in, and which
 * rows read as read. Pure, so vitest covers them (notification-format.test.ts);
 * the bell and the list both read the headline from here, so the two can
 * never say different things.
 */
import { fill } from "./i18n";
import type { NotificationSentence } from "./notification-href";

// ---------- what it says ----------

export type HeadlineInput = {
  sentence: NotificationSentence | null;
  title: string;
  body: string | null;
  actor: { name: string } | null;
  badge: { en: string; ro: string } | null;
  challenge: { milestone: 25 | 50 | 75 | 100; en: string; ro: string } | null;
};

export type HeadlineStrings = {
  notified: Record<NotificationSentence, string>;
  someone: string;
};

/**
 * A sentence about a person for the social categories, the achievement's
 * name for a badge (in the reader's language), the challenge for a
 * challenge step, and the engine's own title for everything else. A social
 * row whose actor is hidden from the reader now (block, suspension,
 * deletion) still reads as a sentence — about "Someone" — never as a name.
 */
export function notificationHeadline(n: HeadlineInput, s: HeadlineStrings, locale: "en" | "ro"): string {
  if (n.sentence === "badge_earned") {
    const name = n.badge ? (locale === "ro" ? n.badge.ro : n.badge.en) : n.body ?? "";
    return fill(s.notified.badge_earned, { name });
  }
  if (n.sentence === "challenge_milestone" || n.sentence === "challenge_completed") {
    if (!n.challenge) return n.title;
    const name = locale === "ro" ? n.challenge.ro : n.challenge.en;
    return fill(s.notified[n.sentence], { name, pct: n.challenge.milestone });
  }
  if (n.sentence) return fill(s.notified[n.sentence], { name: n.actor?.name ?? s.someone });
  return n.title;
}

// ---------- which icon ----------

export type NotificationKind = "follow" | "kudos" | "comment" | "mention" | "badge" | "challenge" | "system";

/** The small mark on the avatar: one per kind of event, "system" for the engine's reminders. */
export function notificationKind(sentence: NotificationSentence | null): NotificationKind {
  switch (sentence) {
    case "new_follower": return "follow";
    case "new_kudos": return "kudos";
    case "new_comment":
    case "comment_reply": return "comment";
    case "new_mention":
    case "new_mention_post": return "mention";
    case "badge_earned": return "badge";
    case "challenge_milestone":
    case "challenge_completed": return "challenge";
    default: return "system";
  }
}

// ---------- which day ----------

export type DayBucket = "today" | "yesterday" | "earlier";

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
function localDay(iso: string, timeZone: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  }
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Today / Yesterday / Earlier, by the calendar in the reader's time zone —
 * not "within 24 hours", so 23:50 yesterday is yesterday at 00:10 today.
 * `nowIso` is passed in (from the server's render) so the server and the
 * browser group identically.
 */
export function dayBucket(iso: string, nowIso: string, timeZone: string): DayBucket {
  const day = localDay(iso, timeZone);
  const today = localDay(nowIso, timeZone);
  if (!day || !today) return "earlier";
  if (day === today) return "today";
  if (day === dayBefore(today)) return "yesterday";
  return "earlier";
}

/** Rows grouped by day bucket, in order, keeping the rows' own order inside each; empty groups dropped. */
export function groupByDay<T extends { created_at: string }>(rows: readonly T[], nowIso: string, timeZone: string) {
  const order: DayBucket[] = ["today", "yesterday", "earlier"];
  const groups = new Map<DayBucket, T[]>(order.map((k) => [k, []]));
  for (const row of rows) groups.get(dayBucket(row.created_at, nowIso, timeZone))!.push(row);
  return order.filter((k) => groups.get(k)!.length > 0).map((k) => ({ bucket: k, rows: groups.get(k)! }));
}

// ---------- which rows read as read ----------

/** Rows marked read on this screen, before the server's read_at comes back. */
export type ReadState = { ids: ReadonlySet<string>; all: boolean };
export type ReadEvent = { type: "mark"; id: string } | { type: "markAll" } | { type: "reset" };

export const READ_NONE: ReadState = { ids: new Set(), all: false };

/**
 * Optimistic read marks. `mark` one when it is followed, `markAll` for the
 * button, `reset` when a refresh brings the server's own read_at — which is
 * then the truth. Rendering the list marks nothing.
 */
export function readReducer(state: ReadState, event: ReadEvent): ReadState {
  switch (event.type) {
    case "mark":
      if (state.all || state.ids.has(event.id)) return state;
      return { ...state, ids: new Set([...state.ids, event.id]) };
    case "markAll":
      return state.all ? state : { ids: state.ids, all: true };
    case "reset":
      return READ_NONE;
  }
}

export function isRowRead(state: ReadState, row: { id: string; read: boolean }): boolean {
  return state.all || row.read || state.ids.has(row.id);
}

/**
 * The unread count to show: the server's total, minus rows marked here that
 * the server still counted as unread. Never below zero; zero after mark all.
 */
export function unreadLeft(state: ReadState, serverUnread: number, rows: readonly { id: string; read: boolean }[]): number {
  if (state.all) return 0;
  const markedHere = rows.filter((r) => !r.read && state.ids.has(r.id)).length;
  return Math.max(0, serverUnread - markedHere);
}
