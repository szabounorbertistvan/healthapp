import { describe, expect, it } from "vitest";
import { routeFor } from "./push-route";

describe("routeFor", () => {
  it("opens the exact thread a message notification names", () => {
    expect(routeFor({ category: "new_message", conversation_id: "6dd616e1-189a-41a4-90b1-146b11e6130b" }))
      .toBe("/thread/6dd616e1-189a-41a4-90b1-146b11e6130b");
    expect(routeFor({ category: "new_message" })).toBe("/messages");
    expect(routeFor({ category: "new_message", conversation_id: "../../etc" })).toBe("/messages");
  });

  it("sends a coach to what needs an answer", () => {
    expect(routeFor({ category: "checkin_submitted" })).toBe("/inbox");
    expect(routeFor({ category: "coaching_request_new" })).toBe("/inbox");
    expect(routeFor({ category: "client_at_risk" })).toBe("/clients");
  });

  it("sends a client to the screen the notification is about", () => {
    expect(routeFor({ category: "new_feedback" })).toBe("/check-in");
    expect(routeFor({ category: "checkin_due" })).toBe("/check-in");
    expect(routeFor({ category: "plan_updated" })).toBe("/workout");
  });

  it("falls back to the list for anything else, or nothing", () => {
    expect(routeFor({ category: "new_follower" })).toBe("/notifications");
    expect(routeFor(undefined)).toBe("/notifications");
    expect(routeFor({ category: 7 })).toBe("/notifications");
  });
});
