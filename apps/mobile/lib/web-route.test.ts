import { describe, expect, it } from "vitest";
import { nativeRoute } from "./web-route";

const ID = "0b9c1f7e-3a7d-4f7e-9c2b-1a2b3c4d5e6f";

describe("nativeRoute", () => {
  it("maps a page with an id to the app's screen for it", () => {
    expect(nativeRoute(`/workout/session/${ID}`)).toBe(`/session/${ID}`);
    expect(nativeRoute(`/feed/${ID}`)).toBe(`/post/${ID}`);
    expect(nativeRoute(`/clients/${ID}`)).toBe(`/coach/client/${ID}`);
    expect(nativeRoute(`/clients/relationship/${ID}`)).toBe(`/coach/relationship/${ID}`);
    expect(nativeRoute(`/people/${ID}`)).toBe(`/people/${ID}`);
    expect(nativeRoute(`/people/${ID}/following`)).toBe(`/people/${ID}/following`);
    expect(nativeRoute("/people?q=ana")).toBe("/people");
    expect(nativeRoute(`/coach/messages/${ID}`)).toBe(`/thread/${ID}`);
    expect(nativeRoute("/coaches/ana-pop")).toBe("/coaches/ana-pop");
    expect(nativeRoute("/achievements/first_workout")).toBe("/achievement/first_workout");
  });
  it("maps plain pages, ignoring the query and the hash", () => {
    expect(nativeRoute("/today?week=current#weekly-report")).toBe("/");
    expect(nativeRoute("/food/plan")).toBe("/meal-plan");
    expect(nativeRoute("/leaderboards?scope=gym")).toBe("/leaderboards");
    expect(nativeRoute("/coaches/bookings/")).toBe("/bookings");
    expect(nativeRoute("/coaches/requests")).toBe("/coaches/requests");
    expect(nativeRoute("/requests?tab=accepted")).toBe("/coach/requests");
    expect(nativeRoute("/bookings/availability")).toBe("/coach/availability");
    expect(nativeRoute("/settings/coach-profile?step=5")).toBe("/coach/profile");
    expect(nativeRoute("/settings/coach-profile#verification")).toBe("/coach/profile");
    expect(nativeRoute("/clients")).toBe("/coach/clients");
    expect(nativeRoute("/clients/challenges")).toBe("/coach/client-challenges");
  });
  it("returns null for what the app does not have", () => {
    expect(nativeRoute("/coaches/city/cluj-napoca")).toBeNull();
    expect(nativeRoute("/coaches/ana-pop/book")).toBeNull();
    expect(nativeRoute("/admin")).toBeNull();
    expect(nativeRoute(`/workout/session/not-an-id`)).toBeNull();
    expect(nativeRoute("https://voinic.fit/today")).toBeNull();
    expect(nativeRoute(null)).toBeNull();
  });
  it("has a screen for every link a notification can carry, so none opens the website", () => {
    // every path apps/web/lib/notification-href.ts returns, bar the admin queue
    const hrefs = [
      "/bookings", "/challenges", "/check-in", "/clients", "/coach", "/coaches/bookings", "/coaches/requests",
      "/feed", "/food", "/habits", "/notifications", "/progress", "/requests", "/reviews",
      "/settings/coach-profile", "/streak", "/today", "/workout",
      "/achievements/first_workout", `/challenges/${ID}`, `/clients/relationship/${ID}`, `/coach/messages/${ID}`,
      "/coaches/ana-pop#reviews", `/feed/${ID}#comment-${ID}`, `/feed/${ID}`, `/messages/${ID}`,
      `/people/${ID}`, `/people/${ID}?tab=achievements`, `/workout/session/${ID}`,
    ];
    for (const href of hrefs) expect(nativeRoute(href), href).not.toBeNull();
  });
});
