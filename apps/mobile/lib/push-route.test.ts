import { describe, expect, it } from "vitest";
import { routeFor } from "./push-route";

describe("routeFor", () => {
  it("opens the native screen a notification is about", () => {
    expect(routeFor({ category: "new_message", conversation_id: "x" })).toBe("/messages");
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
