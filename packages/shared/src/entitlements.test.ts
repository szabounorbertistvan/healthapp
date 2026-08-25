import { describe, expect, test } from "vitest";
import { ENTITLEMENTS, entitlementsFor, TIER_LABEL, type Tier } from "./entitlements";

// The DB stores only the tier; what a tier unlocks is code. The client-slot
// limits below are enforced a second time in SQL (create_invite raises
// CLIENT_LIMIT_REACHED) — if these two drift, the UI offers an invite the
// server then refuses.

describe("entitlementsFor", () => {
  test("gives a Coach Starter three client slots, matching create_invite", () => {
    expect(entitlementsFor("coach_free").maxClients).toBe(3);
  });

  test("gives a Coach Pro thirty client slots, matching create_invite", () => {
    expect(entitlementsFor("coach_pro").maxClients).toBe(30);
  });

  test("gives client tiers no client slots at all", () => {
    expect(entitlementsFor("free").maxClients).toBe(0);
    expect(entitlementsFor("premium").maxClients).toBe(0);
  });

  test("gates progress photos behind Premium", () => {
    expect(entitlementsFor("free").progressPhotos).toBe(false);
    expect(entitlementsFor("premium").progressPhotos).toBe(true);
  });

  test("falls back to free for a tier the app does not know yet", () => {
    expect(entitlementsFor("enterprise" as Tier)).toEqual(ENTITLEMENTS.free);
  });

  test("labels every tier for display", () => {
    for (const tier of Object.keys(ENTITLEMENTS) as Tier[]) {
      expect(TIER_LABEL[tier]).toBeTruthy();
    }
  });
});
