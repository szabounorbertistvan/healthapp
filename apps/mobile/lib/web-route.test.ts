import { describe, expect, it } from "vitest";
import { nativeRoute } from "./web-route";

const ID = "0b9c1f7e-3a7d-4f7e-9c2b-1a2b3c4d5e6f";

describe("nativeRoute", () => {
  it("maps a page with an id to the app's screen for it", () => {
    expect(nativeRoute(`/workout/session/${ID}`)).toBe(`/session/${ID}`);
    expect(nativeRoute(`/feed/${ID}`)).toBe(`/post/${ID}`);
    expect(nativeRoute(`/clients/${ID}`)).toBe(`/coach/client/${ID}`);
    expect(nativeRoute(`/coach/messages/${ID}`)).toBe(`/thread/${ID}`);
  });
  it("maps plain pages, ignoring the query and the hash", () => {
    expect(nativeRoute("/today?week=current#weekly-report")).toBe("/");
    expect(nativeRoute("/food/plan")).toBe("/meal-plan");
    expect(nativeRoute("/leaderboards?scope=gym")).toBe("/leaderboards");
    expect(nativeRoute("/coaches/bookings/")).toBe("/bookings");
  });
  it("leaves what the app does not have to the web", () => {
    expect(nativeRoute("/coaches/some-coach")).toBeNull();
    expect(nativeRoute("/admin")).toBeNull();
    expect(nativeRoute(`/workout/session/not-an-id`)).toBeNull();
    expect(nativeRoute("https://voinic.fit/today")).toBeNull();
    expect(nativeRoute(null)).toBeNull();
  });
});
