/**
 * Where a notification points, and which sentence it reads as — pure, so the
 * routing rule is testable without a database.
 *
 * Two dialects share the table. The catalog in PRODUCT_SPEC §8 — the rows the
 * cron jobs write — carries `payload.screen`. The social triggers do not: kudos
 * writes `post_id`, a follow writes `follower_id`, a badge writes
 * `profile_id`, so those resolve by category. Anything unrecognised renders as
 * a plain row rather than a link that 404s.
 *
 * Every id that reaches a URL is checked to be a uuid first: a payload is
 * written by triggers today, but the href is the one place a malformed value
 * would turn into a navigation.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(payload: Record<string, unknown> | null, key: string): string | null {
  const v = payload?.[key];
  return typeof v === "string" && UUID.test(v) ? v : null;
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
  notifications: "/notifications",
};

export function notificationHref(category: string, payload: Record<string, unknown> | null): string | null {
  const postId = id(payload, "post_id");
  const commentId = id(payload, "comment_id");
  const person = id(payload, "follower_id") ?? id(payload, "actor_id");

  if (category === "new_kudos" && postId) return `/feed/${postId}`;
  if (category === "new_follower" && person) return `/people/${person}`;
  // A comment, a reply and a mention all live on the post; the fragment takes
  // the reader to the exact comment rather than the top of a long thread.
  if ((category === "new_comment" || category === "comment_reply" || category === "new_mention") && postId) {
    return commentId ? `/feed/${postId}#comment-${commentId}` : `/feed/${postId}`;
  }
  if (category === "badge_earned") {
    const profile = id(payload, "profile_id");
    return profile ? `/people/${profile}#achievements` : null;
  }
  if (category === "challenge_milestone") {
    const challenge = id(payload, "challenge_id");
    return challenge ? `/challenges/${challenge}` : null;
  }

  const screen = typeof payload?.screen === "string" ? payload.screen : null;
  return (screen && SCREEN_HREF[screen]) || null;
}

/** The categories that read as a sentence about a person or an achievement. */
export type NotificationSentence =
  | "new_follower"
  | "new_kudos"
  | "new_comment"
  | "comment_reply"
  | "new_mention"
  | "new_mention_post"
  | "badge_earned"
  | "challenge_milestone"
  | "challenge_completed";

/**
 * Which sentence a row reads as. A mention in a caption and a mention in a
 * comment share the category; the comment id is what tells them apart.
 */
export function notificationSentence(category: string, payload: Record<string, unknown> | null): NotificationSentence | null {
  switch (category) {
    case "new_follower":
    case "new_kudos":
    case "new_comment":
    case "comment_reply":
    case "badge_earned":
      return category;
    case "new_mention":
      return id(payload, "comment_id") ? "new_mention" : "new_mention_post";
    // challenge_sync() writes one row per challenge per read: the highest step
    // newly reached, and 100 when the challenge was just completed.
    case "challenge_milestone":
      return payload?.milestone === 100 ? "challenge_completed" : "challenge_milestone";
    default:
      return null;
  }
}

/**
 * The step and the challenge's titles a challenge_milestone row carries, or
 * null for anything that is not one of the four steps.
 */
export function challengeNotice(
  payload: Record<string, unknown> | null,
): { milestone: 25 | 50 | 75 | 100; en: string; ro: string } | null {
  const m = payload?.milestone;
  if (m !== 25 && m !== 50 && m !== 75 && m !== 100) return null;
  const en = typeof payload?.title_en === "string" ? payload.title_en : "";
  const ro = typeof payload?.title_ro === "string" ? payload.title_ro : en;
  return { milestone: m, en, ro };
}

/** The person a notification is about, for the avatar. Null for engine rows. */
export function notificationActorId(payload: Record<string, unknown> | null): string | null {
  return id(payload, "actor_id") ?? id(payload, "follower_id");
}

/**
 * The cursor is "created_at|id", not created_at alone: one award run writes
 * several notifications in one transaction, all with the same now(), and a
 * page boundary between two of them would skip the second on a plain `<`.
 * Parsed strictly, because its parts are spliced into a PostgREST filter.
 */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2}))\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseNotificationCursor(cursor: string | null | undefined): { at: string; id: string } | null {
  const m = cursor ? CURSOR.exec(cursor) : null;
  return m ? { at: m[1]!, id: m[2]! } : null;
}
