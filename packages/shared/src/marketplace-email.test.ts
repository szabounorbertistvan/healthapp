import { describe, expect, it } from "vitest";
import {
  classifyEmailSendStatus, EMAIL_MAX_ATTEMPTS, emailCategoryEnabled, emailRetryDelaySeconds,
  MARKETPLACE_EMAIL_RULES, marketplaceEmailDecision, marketplaceEmailIdempotencyKey, marketplaceEmailPath,
  marketplaceEmailRule, type EmailCandidate, type EmailRecipientState,
} from "./marketplace-email";

const NOW = new Date("2026-10-09T12:00:00Z");
const ID = "11111111-2222-4333-8444-555555555555";
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const live: EmailRecipientState = { hasEmail: true, emailConfirmed: true, suspended: false, deletionRequested: false, prefs: {} };
const row = (category: string, payload: Record<string, unknown>, ageMinutes = 1, readAt: string | null = null): EmailCandidate =>
  ({ category, payload, createdAt: minutesAgo(ageMinutes), readAt });

describe("marketplaceEmailRule", () => {
  it("covers the eight first-release events and nothing else", () => {
    expect(marketplaceEmailRule("coaching_request", { event: "sent" })?.kind).toBe("operational");
    expect(marketplaceEmailRule("booking", { event: "reminder" })?.kind).toBe("operational");
    expect(marketplaceEmailRule("new_message", { conversation_id: ID })?.kind).toBe("optional");
    expect(marketplaceEmailRule("review", { event: "published" })?.kind).toBe("optional");
    expect(marketplaceEmailRule("marketplace", { event: "profile_returned" })?.kind).toBe("operational");
    // in-app only
    expect(marketplaceEmailRule("coaching_request", { event: "cancelled" })).toBeNull();
    expect(marketplaceEmailRule("booking", { event: "completed" })).toBeNull();
    expect(marketplaceEmailRule("coaching", { event: "paused" })).toBeNull();
    expect(marketplaceEmailRule("new_kudos", { post_id: ID })).toBeNull();
    expect(marketplaceEmailRule("marketplace", { event: "review_hidden" })).toBeNull();
  });

  it("has one rule per category and event", () => {
    const keys = MARKETPLACE_EMAIL_RULES.map((r) => `${r.category}/${r.event}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("emailCategoryEnabled", () => {
  const op = { category: "booking", kind: "operational" as const };
  const opt = { category: "new_message", kind: "optional" as const };
  it("keeps operational mail on unless switched off", () => {
    expect(emailCategoryEnabled({}, op)).toBe(true);
    expect(emailCategoryEnabled(null, op)).toBe(true);
    expect(emailCategoryEnabled({ email: { booking: false } }, op)).toBe(false);
  });
  it("keeps optional mail off unless switched on", () => {
    expect(emailCategoryEnabled({}, opt)).toBe(false);
    expect(emailCategoryEnabled({ email: { new_message: true } }, opt)).toBe(true);
    expect(emailCategoryEnabled({ email: { new_message: "yes" } }, opt)).toBe(false);
  });
  it("never reads a push switch as an email consent", () => {
    // top-level keys are push-dispatch's; only `email.*` speaks for email
    expect(emailCategoryEnabled({ new_message: true }, opt)).toBe(false);
    expect(emailCategoryEnabled({ booking: false }, op)).toBe(true);
  });
});

describe("marketplaceEmailDecision", () => {
  it("sends an operational event at once, with its link", () => {
    const d = marketplaceEmailDecision(row("booking", { event: "confirmed", screen: "my_bookings" }), live, NOW);
    expect(d).toMatchObject({ action: "send", path: "/coaches/bookings" });
  });

  it("refuses an address nobody confirmed, an inactive account, or one that opted out", () => {
    const n = row("coaching_request", { event: "sent", screen: "coach_requests" });
    expect(marketplaceEmailDecision(n, { ...live, hasEmail: false }, NOW)).toEqual({ action: "skip", reason: "no_email" });
    expect(marketplaceEmailDecision(n, { ...live, emailConfirmed: false }, NOW)).toEqual({ action: "skip", reason: "email_unconfirmed" });
    expect(marketplaceEmailDecision(n, { ...live, suspended: true }, NOW)).toEqual({ action: "skip", reason: "account_inactive" });
    expect(marketplaceEmailDecision(n, { ...live, deletionRequested: true }, NOW)).toEqual({ action: "skip", reason: "account_inactive" });
    expect(marketplaceEmailDecision(n, { ...live, prefs: { email: { coaching_request: false } } }, NOW))
      .toEqual({ action: "skip", reason: "opted_out" });
  });

  it("holds a message back, then drops it if it was read in the app", () => {
    const opted = { ...live, prefs: { email: { new_message: true } } };
    const payload = { conversation_id: ID, screen: "client_thread" };
    expect(marketplaceEmailDecision(row("new_message", payload, 5), opted, NOW))
      .toEqual({ action: "wait", until: new Date(NOW.getTime() + 10 * 60_000).toISOString() });
    expect(marketplaceEmailDecision(row("new_message", payload, 20, minutesAgo(2)), opted, NOW))
      .toEqual({ action: "skip", reason: "read_in_app" });
    expect(marketplaceEmailDecision(row("new_message", payload, 20), opted, NOW))
      .toMatchObject({ action: "send", path: `/coach/messages/${ID}` });
  });

  it("does not send an optional email to someone who never switched it on", () => {
    expect(marketplaceEmailDecision(row("review", { event: "published", screen: "coach_reviews" }), live, NOW))
      .toEqual({ action: "skip", reason: "opted_out" });
  });

  it("drops what is too old to be useful, such as a reminder after an outage", () => {
    expect(marketplaceEmailDecision(row("booking", { event: "reminder", screen: "my_bookings" }, 7 * 60), live, NOW))
      .toEqual({ action: "skip", reason: "stale" });
    expect(marketplaceEmailDecision({ ...row("booking", { event: "booked" }), createdAt: "nonsense" }, live, NOW))
      .toEqual({ action: "skip", reason: "not_eligible" });
  });
});

describe("marketplaceEmailPath", () => {
  it("never puts an unchecked id or slug into a link", () => {
    expect(marketplaceEmailPath("new_message", { conversation_id: "../admin", screen: "coach_thread" })).toBe("/notifications");
    expect(marketplaceEmailPath("review", { screen: "coach_profile", slug: "https://evil.com" })).toBe("/notifications");
    expect(marketplaceEmailPath("booking", { screen: "unknown" })).toBe("/notifications");
    expect(marketplaceEmailPath("review", { screen: "coach_profile", slug: "ana-pop" })).toBe("/coaches/ana-pop#reviews");
  });
});

describe("delivery helpers", () => {
  it("keys the provider request by the notification, so a retry is the same email", () => {
    expect(marketplaceEmailIdempotencyKey(ID)).toBe(marketplaceEmailIdempotencyKey(ID));
    expect(marketplaceEmailIdempotencyKey(ID)).toContain(ID);
  });

  it("retries what may pass later and stops on what will not", () => {
    expect(classifyEmailSendStatus(200)).toBe("sent");
    for (const s of [0, 408, 429, 500, 502, 503]) expect(classifyEmailSendStatus(s)).toBe("retry");
    for (const s of [400, 401, 403, 404, 422]) expect(classifyEmailSendStatus(s)).toBe("permanent");
  });

  it("backs off and gives up after the last attempt", () => {
    expect(emailRetryDelaySeconds(1)).toBe(60);
    expect(emailRetryDelaySeconds(4)).toBe(3600);
    expect(emailRetryDelaySeconds(EMAIL_MAX_ATTEMPTS)).toBeNull();
    expect(emailRetryDelaySeconds(0)).toBeNull();
  });
});
