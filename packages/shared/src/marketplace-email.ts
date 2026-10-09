/**
 * Marketplace transactional email — the policy only, no delivery.
 *
 * Nothing sends email yet (docs/MARKETPLACE_EMAIL.md). This module is the part
 * of the future dispatcher that can be decided and tested without a database
 * or a provider: which `notifications` rows may become an email, when, to which
 * internal link, and how a provider answer is retried. It has no imports so a
 * Deno edge function can use the same file.
 *
 * The source of every email is one `notifications` row, written by the
 * existing *_notify() functions after their own guard (social_notify_ok:
 * recipient live, not deleting, not blocked). One row → at most one email,
 * keyed by the row's id, so a retry can never become a second message.
 */

export type EmailKind =
  /** Part of a service the person asked for (a booking, a request, their listing). On unless switched off. */
  | "operational"
  /** Useful but not needed to use the service. Off until the person switches it on. */
  | "optional";

export interface MarketplaceEmailRule {
  category: string;
  /** `payload.event`, or "*" for a category whose rows carry none (new_message). */
  event: string;
  kind: EmailKind;
  /** Minutes to hold the email back; with `skipIfRead`, the in-app notice gets a chance first. */
  delayMinutes: number;
  /** Do not email what the person has already seen in the app. */
  skipIfRead: boolean;
  /** An email older than this is not worth sending any more (after an outage, say). */
  maxAgeMinutes: number;
}

const DAY = 24 * 60;

/**
 * The eight marketplace events of the first release. Anything not listed —
 * the social categories, coaching pause/resume/end, a request the client
 * cancelled — stays in-app only.
 */
export const MARKETPLACE_EMAIL_RULES: readonly MarketplaceEmailRule[] = [
  // 1. new coaching request → the coach
  { category: "coaching_request", event: "sent", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 2 * DAY },
  // 2. request answered → the client
  { category: "coaching_request", event: "accepted", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 2 * DAY },
  { category: "coaching_request", event: "declined", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 2 * DAY },
  { category: "coaching_request", event: "started", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 2 * DAY },
  // 3. new booking → the coach (instant booking, or a request to approve)
  { category: "booking", event: "booked", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: DAY },
  { category: "booking", event: "requested", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: DAY },
  // 4. booking answered or cancelled → the other side
  { category: "booking", event: "confirmed", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: DAY },
  { category: "booking", event: "declined", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: DAY },
  { category: "booking", event: "cancelled", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: DAY },
  // 5. the session is within 24 h (detect_booking_reminders) → both sides
  { category: "booking", event: "reminder", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 6 * 60 },
  // 6. new message → held back, and dropped if read in the app first
  { category: "new_message", event: "*", kind: "optional", delayMinutes: 15, skipIfRead: true, maxAgeMinutes: DAY },
  // 7. new review → the coach; an answer to a review → the reviewer
  { category: "review", event: "published", kind: "optional", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 2 * DAY },
  { category: "review", event: "response", kind: "optional", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 2 * DAY },
  // 8. what review did to the coach's listing → the coach
  { category: "marketplace", event: "profile_published", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 3 * DAY },
  { category: "marketplace", event: "profile_returned", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 3 * DAY },
  { category: "marketplace", event: "revision_approved", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 3 * DAY },
  { category: "marketplace", event: "revision_returned", kind: "operational", delayMinutes: 0, skipIfRead: false, maxAgeMinutes: 3 * DAY },
];

export function marketplaceEmailRule(category: string, payload: Record<string, unknown> | null): MarketplaceEmailRule | null {
  const event = typeof payload?.event === "string" ? payload.event : "*";
  return MARKETPLACE_EMAIL_RULES.find((r) => r.category === category && (r.event === event || r.event === "*")) ?? null;
}

/**
 * The email switches live inside the existing `users.notification_prefs`
 * jsonb, under `email` — `{ "email": { "booking": false, "new_message": true } }`.
 * No schema change: the top-level keys stay the push switches push-dispatch
 * reads, and "email" is not a category name. Operational mail is on unless
 * switched off; optional mail is off unless switched on.
 */
export function emailCategoryEnabled(prefs: unknown, rule: Pick<MarketplaceEmailRule, "category" | "kind">): boolean {
  const email = prefs && typeof prefs === "object" ? (prefs as Record<string, unknown>).email : undefined;
  const value = email && typeof email === "object" ? (email as Record<string, unknown>)[rule.category] : undefined;
  return rule.kind === "operational" ? value !== false : value === true;
}

export interface EmailCandidate {
  category: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

/** What the dispatcher knows about the recipient at send time (service role, never sent to a browser). */
export interface EmailRecipientState {
  hasEmail: boolean;
  /** auth.users.email_confirmed_at is set — never mail an address nobody proved they own. */
  emailConfirmed: boolean;
  suspended: boolean;
  deletionRequested: boolean;
  prefs: unknown;
}

export type EmailSkipReason =
  | "not_eligible" | "no_email" | "email_unconfirmed" | "account_inactive" | "opted_out" | "read_in_app" | "stale";

export type EmailDecision =
  | { action: "send"; rule: MarketplaceEmailRule; path: string | null }
  | { action: "wait"; until: string }
  | { action: "skip"; reason: EmailSkipReason };

/**
 * One notification, one decision. Checked at send time, not at enqueue time:
 * an account can be suspended, a preference switched off or a message read
 * between the two.
 */
export function marketplaceEmailDecision(n: EmailCandidate, who: EmailRecipientState, now: Date): EmailDecision {
  const rule = marketplaceEmailRule(n.category, n.payload);
  if (!rule) return { action: "skip", reason: "not_eligible" };
  if (!who.hasEmail) return { action: "skip", reason: "no_email" };
  if (!who.emailConfirmed) return { action: "skip", reason: "email_unconfirmed" };
  if (who.suspended || who.deletionRequested) return { action: "skip", reason: "account_inactive" };
  if (!emailCategoryEnabled(who.prefs, rule)) return { action: "skip", reason: "opted_out" };
  if (rule.skipIfRead && n.readAt) return { action: "skip", reason: "read_in_app" };

  const created = new Date(n.createdAt).getTime();
  if (Number.isNaN(created)) return { action: "skip", reason: "not_eligible" };
  if (now.getTime() - created > rule.maxAgeMinutes * 60_000) return { action: "skip", reason: "stale" };
  const due = created + rule.delayMinutes * 60_000;
  if (now.getTime() < due) return { action: "wait", until: new Date(due).toISOString() };

  return { action: "send", rule, path: marketplaceEmailPath(n.category, n.payload) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

/** The marketplace screens, as apps/web/lib/notification-href.ts maps them (a test keeps the two equal). */
const SCREEN_PATH: Record<string, string> = {
  coach_requests: "/requests",
  my_requests: "/coaches/requests",
  coach: "/coach",
  coach_bookings: "/bookings",
  my_bookings: "/coaches/bookings",
  coach_reviews: "/reviews",
  coach_profile_settings: "/settings/coach-profile",
};

/**
 * The in-app page an email links to — a path only; the dispatcher prefixes
 * the site URL it is configured with. Ids are checked before they reach a
 * URL; anything unknown links to the notification list rather than a 404.
 */
export function marketplaceEmailPath(category: string, payload: Record<string, unknown> | null): string {
  const screen = typeof payload?.screen === "string" ? payload.screen : null;
  if (category === "new_message") {
    const c = typeof payload?.conversation_id === "string" && UUID.test(payload.conversation_id) ? payload.conversation_id : null;
    if (c && screen === "coach_thread") return `/messages/${c}`;
    if (c && screen === "client_thread") return `/coach/messages/${c}`;
  }
  if (category === "review" && screen === "coach_profile") {
    const slug = typeof payload?.slug === "string" && SLUG.test(payload.slug) ? payload.slug : null;
    if (slug) return `/coaches/${slug}#reviews`;
  }
  return (screen && SCREEN_PATH[screen]) || "/notifications";
}

/** The provider idempotency key: one notification can only ever be one email. */
export function marketplaceEmailIdempotencyKey(notificationId: string): string {
  return `voinic-notification-${notificationId}`;
}

export const EMAIL_MAX_ATTEMPTS = 5;

/**
 * How a provider answer is treated. `retry`: the request may succeed later
 * (network, timeout, rate limit, provider outage). `permanent`: it will not
 * (a bad address, a rejected payload, a bad key) — retrying only repeats the
 * failure and, for a key problem, needs a person.
 */
export function classifyEmailSendStatus(status: number): "sent" | "retry" | "permanent" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return "retry";
  return "permanent";
}

/** Seconds before attempt `attempt` (1-based) is retried: 1, 5, 15, 60 min; null once attempts run out. */
export function emailRetryDelaySeconds(attempt: number): number | null {
  const steps = [60, 300, 900, 3600];
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= EMAIL_MAX_ATTEMPTS) return null;
  return steps[Math.min(attempt, steps.length) - 1] ?? null;
}
