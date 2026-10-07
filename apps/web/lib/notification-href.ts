/**
 * Where a notification points, and which sentence it reads as — pure, so the
 * routing rule is testable without a database.
 *
 * Two dialects share the table. The catalog in PRODUCT_SPEC §8 — the rows the
 * cron jobs write — carries `payload.screen`. The social triggers do not: kudos
 * writes `post_id`, a follow writes `follower_id`, a badge writes
 * `profile_id`, so those resolve by category. Anything unrecognised renders as
 * a plain row rather than a link that 404s. A badge links to its own detail
 * page when the slug is in the catalog.
 *
 * Every id that reaches a URL is checked to be a uuid first: a payload is
 * written by triggers today, but the href is the one place a malformed value
 * would turn into a navigation.
 */

import { isBadgeSlug } from "@healthapp/shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A coach slug as coach_profiles allows it: lower-case words and hyphens. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

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
  // contact requests (20261103100000)
  coach_requests: "/requests",
  my_requests: "/coaches/requests",
  // bookings (20261105100000)
  coach_bookings: "/bookings",
  my_bookings: "/coaches/bookings",
  // reviews (20261106100000): the coach's list; a reviewer's answer is on the coach's page
  coach_reviews: "/reviews",
  // moderation outcomes (20261110110000): the coach's own profile settings
  coach_profile_settings: "/settings/coach-profile",
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
    // The row is the owner's own, so it opens their detail page for the
    // badge; a slug outside the catalog falls back to the profile shelf.
    const slug = payload?.badge_slug;
    if (isBadgeSlug(slug)) return `/achievements/${slug}`;
    const profile = id(payload, "profile_id");
    return profile ? `/people/${profile}?tab=achievements` : null;
  }
  // A message (20261104100000) opens its own thread, on the recipient's side
  // of it: a coach's inbox lives under (coach), a client's under /coach.
  if (category === "new_message") {
    const conversation = id(payload, "conversation_id");
    if (conversation && payload?.screen === "coach_thread") return `/messages/${conversation}`;
    if (conversation && payload?.screen === "client_thread") return `/coach/messages/${conversation}`;
  }
  // An answer to the reader's review (20261106100000) is read under it, on the coach's page.
  if (category === "review" && payload?.screen === "coach_profile") {
    const slug = typeof payload?.slug === "string" && SLUG.test(payload.slug) ? payload.slug : null;
    return slug ? `/coaches/${slug}#reviews` : null;
  }
  // a lifecycle change seen by the coach opens that relationship's page (20261109110000)
  if (category === "coaching" && payload?.screen === "coach_relationship") {
    const rel = id(payload, "relationship_id");
    return rel ? `/clients/relationship/${rel}` : "/clients";
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
  | "new_love"
  | "new_comment"
  | "comment_reply"
  | "new_mention"
  | "new_mention_post"
  | "badge_earned"
  | "challenge_milestone"
  | "challenge_completed"
  | "request_sent"
  | "request_accepted"
  | "request_declined"
  | "request_cancelled"
  | "request_started"
  | "new_message"
  | "booking_requested"
  | "booking_booked"
  | "booking_confirmed"
  | "booking_declined"
  | "booking_cancelled"
  | "booking_reminder"
  | "review_published"
  | "review_response"
  | "coaching_paused"
  | "coaching_resumed"
  | "coaching_ended"
  | MarketplaceSentence;

/** What moderation told a coach about their listing (20261110110000). */
export const MARKETPLACE_EVENTS = [
  "verification_verified", "verification_rejected", "profile_published", "profile_returned", "profile_unpublished",
  "profile_suspended", "profile_restored", "review_hidden",
] as const;
export type MarketplaceSentence = `marketplace_${(typeof MARKETPLACE_EVENTS)[number]}`;

/**
 * Which sentence a row reads as. A mention in a caption and a mention in a
 * comment share the category; the comment id is what tells them apart.
 */
export function notificationSentence(category: string, payload: Record<string, unknown> | null): NotificationSentence | null {
  switch (category) {
    // One category for both reactions; the payload says which arrived.
    case "new_kudos":
      return payload?.reaction === "love" ? "new_love" : "new_kudos";
    case "new_follower":
    case "new_comment":
    case "comment_reply":
    case "badge_earned":
    case "new_message":
      return category;
    case "new_mention":
      return id(payload, "comment_id") ? "new_mention" : "new_mention_post";
    // challenge_sync() writes one row per challenge per read: the highest step
    // newly reached, and 100 when the challenge was just completed.
    case "challenge_milestone":
      return payload?.milestone === 100 ? "challenge_completed" : "challenge_milestone";
    // one category for a contact request's four moves; the payload says which
    case "coaching_request":
      switch (payload?.event) {
        case "sent": return "request_sent";
        case "accepted": return "request_accepted";
        case "declined": return "request_declined";
        case "cancelled": return "request_cancelled";
        // start_coaching_from_request (20261108100000): the client is told coaching began
        case "started": return "request_started";
        default: return null;
      }
    // the lifecycle's three notices (20261109110000)
    case "coaching":
      return payload?.event === "paused" ? "coaching_paused" : payload?.event === "resumed" ? "coaching_resumed"
        : payload?.event === "ended" ? "coaching_ended" : null;
    // moderation outcomes, one category (20261110110000)
    case "marketplace":
      return (MARKETPLACE_EVENTS as readonly unknown[]).includes(payload?.event)
        ? (`marketplace_${payload?.event as (typeof MARKETPLACE_EVENTS)[number]}` as const) : null;
    // one category for a review's two notices (20261106100000)
    case "review":
      return payload?.event === "published" ? "review_published" : payload?.event === "response" ? "review_response" : null;
    // one category for a booking's moves (20261105100000); the payload says which
    case "booking":
      switch (payload?.event) {
        case "requested": return "booking_requested";
        case "booked": return "booking_booked";
        case "confirmed": return "booking_confirmed";
        case "declined": return "booking_declined";
        case "cancelled": return "booking_cancelled";
        case "reminder": return "booking_reminder";
        default: return null;
      }
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

/** The post a social row is about, if it names one. */
export function notificationPostId(payload: Record<string, unknown> | null): string | null {
  return id(payload, "post_id");
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
