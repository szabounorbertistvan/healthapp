import { describe, expect, it } from "vitest";
import {
  annualFromMonthly, effectiveTier, tierForLookupKey, trialDaysLeft, trialTierFor,
} from "./billing";

const NOW = new Date("2026-08-26T12:00:00Z");

describe("effectiveTier", () => {
  it("returns the paid tier when the subscription is active", () => {
    expect(effectiveTier({ tier: "premium", status: "active" }, "client", NOW)).toBe("premium");
    expect(effectiveTier({ tier: "coach_pro", status: "active" }, "coach", NOW)).toBe("coach_pro");
  });

  it("grants the role's full paid tier during an unexpired trial", () => {
    const sub = { tier: "free" as const, status: "active", trial_ends_at: "2026-09-01T00:00:00Z" };
    expect(effectiveTier(sub, "client", NOW)).toBe("premium");
    expect(effectiveTier(sub, "coach", NOW)).toBe("coach_pro");
    expect(effectiveTier(sub, "both", NOW)).toBe("coach_pro");
  });

  it("falls back to free after the trial expires", () => {
    const sub = { tier: "free" as const, status: "active", trial_ends_at: "2026-08-01T00:00:00Z" };
    expect(effectiveTier(sub, "client", NOW)).toBe("free");
  });

  it("ignores a paid tier whose subscription lapsed, but honors a live trial", () => {
    expect(effectiveTier({ tier: "premium", status: "canceled" }, "client", NOW)).toBe("free");
    expect(
      effectiveTier(
        { tier: "premium", status: "past_due", trial_ends_at: "2026-09-01T00:00:00Z" },
        "client",
        NOW,
      ),
    ).toBe("premium");
  });

  it("handles a missing subscription row", () => {
    expect(effectiveTier(null, "client", NOW)).toBe("free");
  });
});

describe("trialDaysLeft", () => {
  it("rounds up partial days and never goes negative", () => {
    expect(trialDaysLeft("2026-08-27T13:00:00Z", NOW)).toBe(2);
    expect(trialDaysLeft("2026-08-26T12:00:01Z", NOW)).toBe(1);
    expect(trialDaysLeft("2026-08-01T00:00:00Z", NOW)).toBe(0);
    expect(trialDaysLeft(null, NOW)).toBeNull();
  });
});

describe("pricing helpers", () => {
  it("annual is 12 months minus 15%", () => {
    expect(annualFromMonthly(10)).toBe(102);
  });

  it("maps lookup keys back to tiers", () => {
    expect(tierForLookupKey("premium_monthly")).toBe("premium");
    expect(tierForLookupKey("coach_pro_annual")).toBe("coach_pro");
    expect(tierForLookupKey("something_else")).toBeNull();
    expect(tierForLookupKey(null)).toBeNull();
  });

  it("trial tier follows role", () => {
    expect(trialTierFor("client")).toBe("premium");
    expect(trialTierFor("coach")).toBe("coach_pro");
  });
});
