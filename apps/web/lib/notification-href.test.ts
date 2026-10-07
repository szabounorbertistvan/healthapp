import { describe, expect, it } from "vitest";
import { challengeNotice, notificationActorId, notificationHref, notificationSentence, parseNotificationCursor } from "./notification-href";

const POST = "11111111-1111-4111-8111-111111111111";
const COMMENT = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";

describe("notificationHref", () => {
  it("sends kudos to the post", () => {
    expect(notificationHref("new_kudos", { post_id: POST, actor_id: PERSON })).toBe(`/feed/${POST}`);
  });

  it("sends a follower to their profile, from either payload dialect", () => {
    expect(notificationHref("new_follower", { follower_id: PERSON })).toBe(`/people/${PERSON}`);
    expect(notificationHref("new_follower", { actor_id: PERSON })).toBe(`/people/${PERSON}`);
  });

  it("sends a comment, reply or comment-mention to the exact comment", () => {
    for (const c of ["new_comment", "comment_reply", "new_mention"]) {
      expect(notificationHref(c, { post_id: POST, comment_id: COMMENT })).toBe(`/feed/${POST}#comment-${COMMENT}`);
    }
  });

  it("sends a caption mention to the post itself", () => {
    expect(notificationHref("new_mention", { post_id: POST, actor_id: PERSON })).toBe(`/feed/${POST}`);
  });

  it("sends a badge to its own achievement page", () => {
    expect(notificationHref("badge_earned", { badge_slug: "first-pr", profile_id: PERSON })).toBe("/achievements/first-pr");
    expect(notificationHref("badge_earned", { badge_slug: "bench-100" })).toBe("/achievements/bench-100");
  });

  it("falls back to the profile shelf for a slug outside the catalog", () => {
    expect(notificationHref("badge_earned", { badge_slug: "../admin", profile_id: PERSON })).toBe(`/people/${PERSON}?tab=achievements`);
    expect(notificationHref("badge_earned", { badge_slug: "retired-badge" })).toBeNull();
  });

  it("resolves engine rows by screen, and nothing unknown", () => {
    expect(notificationHref("streak_risk", { screen: "today" })).toBe("/today");
    expect(notificationHref("streak_risk", { screen: "nowhere" })).toBeNull();
    expect(notificationHref("anything", null)).toBeNull();
  });

  it("never builds a link from something that is not a uuid", () => {
    expect(notificationHref("new_kudos", { post_id: "../admin" })).toBeNull();
    expect(notificationHref("new_follower", { follower_id: "javascript:alert(1)" })).toBeNull();
    expect(notificationHref("new_comment", { post_id: POST, comment_id: "x\" onload=\"" })).toBe(`/feed/${POST}`);
    expect(notificationHref("new_kudos", { post_id: 42 })).toBeNull();
  });
});

describe("contact requests (20261103100000)", () => {
  it("one category reads as four sentences, by the event", () => {
    expect(notificationSentence("coaching_request", { event: "sent" })).toBe("request_sent");
    expect(notificationSentence("coaching_request", { event: "accepted" })).toBe("request_accepted");
    expect(notificationSentence("coaching_request", { event: "declined" })).toBe("request_declined");
    expect(notificationSentence("coaching_request", { event: "cancelled" })).toBe("request_cancelled");
    expect(notificationSentence("coaching_request", { event: "started" })).toBe("request_started");
    expect(notificationSentence("coaching_request", { event: "other" })).toBeNull();
  });
  it("the coach's notices open Requests, the client's open My requests", () => {
    expect(notificationHref("coaching_request", { screen: "coach_requests" })).toBe("/requests");
    expect(notificationHref("coaching_request", { screen: "my_requests" })).toBe("/coaches/requests");
    // coaching started: the client's coach page and thread
    expect(notificationHref("coaching_request", { screen: "coach" })).toBe("/coach");
  });
});

describe("messages (20261104100000)", () => {
  it("opens the thread on the recipient's side", () => {
    expect(notificationHref("new_message", { conversation_id: POST, screen: "coach_thread" })).toBe(`/messages/${POST}`);
    expect(notificationHref("new_message", { conversation_id: POST, screen: "client_thread" })).toBe(`/coach/messages/${POST}`);
  });
  it("falls back to the catalog screen, and never links a bad id", () => {
    expect(notificationHref("new_message", { screen: "messages" })).toBe("/coach");
    expect(notificationHref("new_message", { conversation_id: "../admin", screen: "coach_thread" })).toBeNull();
  });
  it("reads as a sentence about the sender", () => {
    expect(notificationSentence("new_message", { conversation_id: POST })).toBe("new_message");
  });
});

describe("bookings (20261105100000)", () => {
  it("one category reads as six sentences, by the event", () => {
    expect(notificationSentence("booking", { event: "requested" })).toBe("booking_requested");
    expect(notificationSentence("booking", { event: "booked" })).toBe("booking_booked");
    expect(notificationSentence("booking", { event: "confirmed" })).toBe("booking_confirmed");
    expect(notificationSentence("booking", { event: "declined" })).toBe("booking_declined");
    expect(notificationSentence("booking", { event: "cancelled" })).toBe("booking_cancelled");
    expect(notificationSentence("booking", { event: "reminder" })).toBe("booking_reminder");
    expect(notificationSentence("booking", { event: "other" })).toBeNull();
  });
  it("the coach's notices open Bookings, the client's open My bookings", () => {
    expect(notificationHref("booking", { screen: "coach_bookings" })).toBe("/bookings");
    expect(notificationHref("booking", { screen: "my_bookings" })).toBe("/coaches/bookings");
  });
});

describe("reviews (20261106100000)", () => {
  it("a new review opens the coach's Reviews, an answer opens the coach's page at its reviews", () => {
    expect(notificationHref("review", { event: "published", screen: "coach_reviews", slug: "andrei-popescu" })).toBe("/reviews");
    expect(notificationHref("review", { event: "response", screen: "coach_profile", slug: "andrei-popescu" }))
      .toBe("/coaches/andrei-popescu#reviews");
  });
  it("never builds a link from a slug that is not one", () => {
    expect(notificationHref("review", { screen: "coach_profile", slug: "../admin" })).toBeNull();
    expect(notificationHref("review", { screen: "coach_profile", slug: null })).toBeNull();
  });
  it("reads as a sentence about the person", () => {
    expect(notificationSentence("review", { event: "published" })).toBe("review_published");
    expect(notificationSentence("review", { event: "response" })).toBe("review_response");
    expect(notificationSentence("review", { event: "other" })).toBeNull();
  });
});

describe("marketplace moderation notices (20261110110000)", () => {
  it("open the coach's own settings or their reviews", () => {
    expect(notificationHref("marketplace", { event: "profile_suspended", screen: "coach_profile_settings" })).toBe("/settings/coach-profile");
    expect(notificationHref("marketplace", { event: "review_hidden", screen: "coach_reviews" })).toBe("/reviews");
  });
  it("read as a fixed sentence, unknown events as nothing", () => {
    expect(notificationSentence("marketplace", { event: "verification_verified" })).toBe("marketplace_verification_verified");
    expect(notificationSentence("marketplace", { event: "review_hidden" })).toBe("marketplace_review_hidden");
    expect(notificationSentence("marketplace", { event: "whatever" })).toBeNull();
  });
});

describe("coaching lifecycle (20261109110000)", () => {
  it("the client opens their coach, the coach opens that relationship", () => {
    expect(notificationHref("coaching", { screen: "coach", event: "paused" })).toBe("/coach");
    expect(notificationHref("coaching", { screen: "coach_relationship", relationship_id: POST })).toBe(`/clients/relationship/${POST}`);
    expect(notificationHref("coaching", { screen: "coach_relationship", relationship_id: "../x" })).toBe("/clients");
  });
  it("reads as paused / resumed / ended", () => {
    expect(notificationSentence("coaching", { event: "paused" })).toBe("coaching_paused");
    expect(notificationSentence("coaching", { event: "resumed" })).toBe("coaching_resumed");
    expect(notificationSentence("coaching", { event: "ended" })).toBe("coaching_ended");
    expect(notificationSentence("coaching", { event: "x" })).toBeNull();
  });
});

describe("notificationSentence", () => {
  it("tells a caption mention from a comment mention", () => {
    expect(notificationSentence("new_mention", { post_id: POST, comment_id: COMMENT })).toBe("new_mention");
    expect(notificationSentence("new_mention", { post_id: POST })).toBe("new_mention_post");
  });
  it("names the social categories and leaves engine rows alone", () => {
    expect(notificationSentence("badge_earned", {})).toBe("badge_earned");
    expect(notificationSentence("new_kudos", {})).toBe("new_kudos");
    expect(notificationSentence("checkin_due", {})).toBeNull();
  });
});

describe("notificationActorId", () => {
  it("prefers actor_id, falls back to follower_id, ignores junk", () => {
    expect(notificationActorId({ actor_id: PERSON, follower_id: POST })).toBe(PERSON);
    expect(notificationActorId({ follower_id: PERSON })).toBe(PERSON);
    expect(notificationActorId({ actor_id: "nope" })).toBeNull();
    expect(notificationActorId(null)).toBeNull();
  });
});


describe("parseNotificationCursor", () => {
  it("reads created_at|id as PostgREST returns it", () => {
    expect(parseNotificationCursor(`2026-09-23T17:00:00.123456+00:00|${POST}`)).toEqual({ at: "2026-09-23T17:00:00.123456+00:00", id: POST });
    expect(parseNotificationCursor(`2026-09-23T17:00:00Z|${POST}`)).toEqual({ at: "2026-09-23T17:00:00Z", id: POST });
  });
  it("refuses anything that could widen the filter it is spliced into", () => {
    expect(parseNotificationCursor(null)).toBeNull();
    expect(parseNotificationCursor("2026-09-23T17:00:00Z")).toBeNull();
    expect(parseNotificationCursor(`2026-09-23T17:00:00Z|${POST}),user_id.neq.x`)).toBeNull();
    expect(parseNotificationCursor(`2026-09-23T17:00:00Z,id.gt.0|${POST}`)).toBeNull();
    expect(parseNotificationCursor(`2026-09-23T17:00:00Z|not-a-uuid`)).toBeNull();
  });
});

describe("challenge notifications", () => {
  const challenge = "c5000000-0000-0000-0000-000000000001";

  it("link to the challenge", () => {
    expect(notificationHref("challenge_milestone", { challenge_id: challenge, milestone: 50 })).toBe(`/challenges/${challenge}`);
    expect(notificationHref("challenge_milestone", { challenge_id: "../admin", milestone: 50 })).toBeNull();
  });

  it("read as a milestone, or as completion at 100 %", () => {
    expect(notificationSentence("challenge_milestone", { milestone: 50 })).toBe("challenge_milestone");
    expect(notificationSentence("challenge_milestone", { milestone: 100 })).toBe("challenge_completed");
  });

  it("carry the step and both titles, and nothing that is not one of the four steps", () => {
    expect(challengeNotice({ milestone: 75, title_en: "Volume", title_ro: "Volum" })).toEqual({ milestone: 75, en: "Volume", ro: "Volum" });
    expect(challengeNotice({ milestone: 60, title_en: "Volume" })).toBeNull();
    expect(challengeNotice(null)).toBeNull();
  });
});
