import { describe, expect, test } from "vitest";
import {
  atLimit, ENTITLEMENTS, entitlementsFor, historyStart, isPlanLimitError, planEntitlements, planLimit, TIER_LABEL, type Tier,
} from "./entitlements";

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

  test("keeps uploading progress photos free and puts the comparison behind Premium", () => {
    expect(entitlementsFor("free").photoCompare).toBe(false);
    expect(entitlementsFor("premium").photoCompare).toBe(true);
  });

  test("keeps a Starter coach's own training on the free set", () => {
    const starter = entitlementsFor("coach_free");
    expect(starter.historyDays).toBe(ENTITLEMENTS.free.historyDays);
    expect(starter.progressCharts).toBe(false);
    expect(starter.maxCustomExercises).toBe(10);
  });

  test("gives Coach Pro every Premium feature plus the coaching ones", () => {
    const pro = entitlementsFor("coach_pro");
    for (const key of Object.keys(ENTITLEMENTS.premium) as (keyof typeof pro)[]) {
      if (key === "maxClients" || key === "advancedAnalytics" || key === "programCopy" || key === "ingredientPlans") continue;
      expect(pro[key]).toEqual(ENTITLEMENTS.premium[key]);
    }
    expect(pro.advancedAnalytics && pro.programCopy && pro.ingredientPlans).toBe(true);
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

describe("planEntitlements", () => {
  test("answers the real tier once the paywall is on", () => {
    expect(planEntitlements("free", true)).toEqual(ENTITLEMENTS.free);
  });

  test("unlocks the role's full paid set while the paywall is off", () => {
    expect(planEntitlements("free", false)).toEqual(ENTITLEMENTS.premium);
    expect(planEntitlements("coach_free", false).advancedAnalytics).toBe(true);
  });

  test("keeps the roster cap, which create_invite enforces regardless of the switch", () => {
    expect(planEntitlements("coach_free", false).maxClients).toBe(3);
  });
});

// These four numbers are mirrored by plan_limit() in
// supabase/migrations/20260923120000_paywall.sql. Change both or neither.
describe("planLimit mirrors plan_limit() in SQL", () => {
  test("free", () => {
    const e = ENTITLEMENTS.free;
    expect([planLimit(e, "own_programs"), planLimit(e, "custom_exercises"), planLimit(e, "favorite_foods"), planLimit(e, "barcode_scans_day")])
      .toEqual([1, 3, 10, 5]);
  });

  test("coach_free", () => {
    const e = ENTITLEMENTS.coach_free;
    expect([planLimit(e, "own_programs"), planLimit(e, "custom_exercises"), planLimit(e, "favorite_foods"), planLimit(e, "barcode_scans_day")])
      .toEqual([1, 10, 10, 5]);
  });

  test("paid tiers are unlimited", () => {
    for (const tier of ["premium", "coach_pro"] as const) {
      const e = ENTITLEMENTS[tier];
      expect([planLimit(e, "own_programs"), planLimit(e, "custom_exercises"), planLimit(e, "favorite_foods"), planLimit(e, "barcode_scans_day")])
        .toEqual([null, null, null, null]);
    }
  });
});

describe("limit helpers", () => {
  test("atLimit treats null as unlimited", () => {
    expect(atLimit(null, 1_000)).toBe(false);
    expect(atLimit(3, 2)).toBe(false);
    expect(atLimit(3, 3)).toBe(true);
  });

  test("isPlanLimitError finds the code inside a PostgREST message", () => {
    expect(isPlanLimitError("PLAN_LIMIT_REACHED")).toBe(true);
    expect(isPlanLimitError("duplicate key")).toBe(false);
    expect(isPlanLimitError(null)).toBe(false);
  });

  test("historyStart counts today as the first of the window", () => {
    expect(historyStart({ historyDays: 30 }, "2026-09-30")).toBe("2026-09-01");
    expect(historyStart({ historyDays: 1 }, "2026-03-01")).toBe("2026-03-01");
    expect(historyStart({ historyDays: null }, "2026-09-30")).toBeNull();
  });
});
