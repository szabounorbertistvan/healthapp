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

  it("sends a badge to the achievements on the owner's profile", () => {
    expect(notificationHref("badge_earned", { badge_slug: "first-pr", profile_id: PERSON })).toBe(`/people/${PERSON}#achievements`);
    expect(notificationHref("badge_earned", { badge_slug: "first-pr" })).toBeNull();
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
