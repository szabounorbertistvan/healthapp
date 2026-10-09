import { describe, expect, it } from "vitest";
import { MARKETPLACE_EMAIL_RULES, marketplaceEmailPath } from "@healthapp/shared";
import { notificationHref } from "./notification-href";

// An email and the in-app notice for the same row must open the same page.
// The email side keeps its own small map (it must also run in Deno), so this
// test is what stops the two from drifting apart.
const ID = "11111111-2222-4333-8444-555555555555";
const payloads: Record<string, Record<string, unknown>[]> = {
  coaching_request: [{ screen: "coach_requests" }, { screen: "my_requests" }, { screen: "coach" }],
  booking: [{ screen: "coach_bookings" }, { screen: "my_bookings" }],
  new_message: [{ conversation_id: ID, screen: "coach_thread" }, { conversation_id: ID, screen: "client_thread" }],
  review: [{ screen: "coach_reviews" }, { screen: "coach_profile", slug: "ana-pop" }],
  marketplace: [{ screen: "coach_profile_settings" }],
};

describe("marketplace email links", () => {
  it("open the same page as the in-app notification", () => {
    const categories = new Set(MARKETPLACE_EMAIL_RULES.map((r) => r.category));
    for (const category of categories) {
      const cases = payloads[category];
      expect(cases, category).toBeDefined();
      for (const payload of cases!) {
        expect(marketplaceEmailPath(category, payload)).toBe(notificationHref(category, payload));
      }
    }
  });
});
