import { describe, expect, it } from "vitest";
import {
  STEPS, centsToPrice, formatPrice, coachingSinceError, identityErrors, missingFor, moveItem, nextStep, parseStep,
  previousStep, priceToCents, serviceErrors, slugify, statusView, stepForMissing, stepsTouched, summary,
  toggleSpecialization, type DraftState, PRICING_MODELS, credentialLabel, verificationView, parseDuration, pricingOf, takesPrice, unitsFor,
} from "./coach-onboarding";

const empty: DraftState = {
  slug: "andrei-pop", headline: "", about: "", coachingSince: null, online: false, inPerson: false,
  specializations: [], primarySpecialization: null, languages: [], locations: [], services: [], hasAvatar: false,
};

const complete: DraftState = {
  ...empty,
  headline: "Personal Trainer & Nutrition Coach",
  about: "Ten years of coaching.",
  coachingSince: 2015,
  online: true,
  specializations: ["hypertrophy"],
  primarySpecialization: "hypertrophy",
  services: [{ active: true, priceUnit: "month", priceCents: 9900 }],
  hasAvatar: true,
};

describe("wizard navigation", () => {
  it("has six steps", () => {
    expect(STEPS).toHaveLength(6);
  });
  it("reads ?step as 1-based and clamps it", () => {
    expect(parseStep("3")).toBe(2);
    expect(parseStep("1")).toBe(0);
    expect(parseStep("6")).toBe(5);
    expect(parseStep("99")).toBe(5);
    expect(parseStep("0")).toBe(0);
    expect(parseStep("-4")).toBe(0);
    expect(parseStep("abc")).toBe(0);
    expect(parseStep(undefined)).toBe(0);
    expect(parseStep(["4", "2"])).toBe(3);
  });
  it("moves forward and back without leaving the range", () => {
    expect(nextStep(0)).toBe(1);
    expect(nextStep(5)).toBe(5);
    expect(previousStep(3)).toBe(2);
    expect(previousStep(0)).toBe(0);
  });
});

describe("submit checklist (mirror of coach_profile_missing)", () => {
  it("an empty draft lists everything required", () => {
    expect(missingFor(empty)).toEqual(["HEADLINE", "ABOUT", "SPECIALIZATION", "DELIVERY_MODE", "SERVICE", "AVATAR"]);
  });
  it("a complete online-only draft is ready, with no city", () => {
    expect(missingFor(complete)).toEqual([]);
  });
  it("in person needs at least one location", () => {
    const inPerson = { ...complete, online: false, inPerson: true };
    expect(missingFor(inPerson)).toEqual(["LOCATION"]);
    expect(missingFor({ ...inPerson, locations: [{ city: "cluj-napoca", gymName: "" }] })).toEqual([]);
  });
  it("neither online nor in person is a missing delivery mode, even with a city", () => {
    const none = { ...complete, online: false, locations: [{ city: "cluj-napoca", gymName: "" }] };
    expect(missingFor(none)).toEqual(["DELIVERY_MODE"]);
  });
  it("an inactive service does not count; a priced unit needs a price", () => {
    expect(missingFor({ ...complete, services: [{ active: false, priceUnit: "month", priceCents: 100 }] })).toContain("SERVICE");
    expect(missingFor({ ...complete, services: [{ active: true, priceUnit: "session", priceCents: null }] })).toEqual(["SERVICE_PRICE"]);
    expect(missingFor({ ...complete, services: [{ active: true, priceUnit: "custom", priceCents: null }] })).toEqual([]);
  });
  it("needs the profile photo and a valid slug", () => {
    expect(missingFor({ ...complete, hasAvatar: false })).toEqual(["AVATAR"]);
    expect(missingFor({ ...complete, slug: "No Slug" })).toEqual(["SLUG"]);
  });
  it("refuses a coaching start year in the future", () => {
    expect(missingFor({ ...complete, coachingSince: 2031 }, 2026)).toEqual(["COACHING_SINCE"]);
  });
  it("every missing code points at a step", () => {
    expect(stepForMissing("HEADLINE")).toBe(0);
    expect(stepForMissing("SPECIALIZATION")).toBe(1);
    expect(stepForMissing("LOCATION")).toBe(2);
    expect(stepForMissing("SERVICE_PRICE")).toBe(4);
    expect(stepForMissing("AVATAR")).toBe(5);
  });
  it("the summary ticks the five groups", () => {
    expect(summary([])).toEqual([
      { group: "professional", done: true }, { group: "specializations", done: true },
      { group: "location", done: true }, { group: "services", done: true }, { group: "photo", done: true },
    ]);
    expect(summary(["AVATAR", "LOCATION"]).filter((s) => !s.done).map((s) => s.group)).toEqual(["location", "photo"]);
  });
  it("tracks which steps have content", () => {
    expect(stepsTouched(empty, 0)).toEqual([false, false, false, false, false, false]);
    expect(stepsTouched(complete, 1)).toEqual([true, true, true, true, true, true]);
  });
});

describe("identity validation", () => {
  it("flags only what the database would refuse", () => {
    expect(identityErrors({ headline: "", about: "", slug: "andrei-pop" })).toEqual({});
    expect(identityErrors({ headline: "x".repeat(121), about: "", slug: "andrei-pop" })).toEqual({ headline: "TOO_LONG" });
    expect(identityErrors({ headline: "", about: "x".repeat(3001), slug: "ab" })).toEqual({ about: "TOO_LONG", slug: "FORMAT" });
  });
  it("slugifies as the coach types", () => {
    expect(slugify("Andrei Pop")).toBe("andrei-pop");
    expect(slugify("Ștefan Ionuț")).toBe("stefan-ionut");
    expect(slugify("a__b")).toBe("a-b");
  });
  it("checks the coaching start year", () => {
    expect(coachingSinceError(null)).toBeNull();
    expect(coachingSinceError(2015, 2026)).toBeNull();
    expect(coachingSinceError(1900, 2026)).toBe("RANGE");
    expect(coachingSinceError(2027, 2026)).toBe("RANGE");
  });
});

describe("specializations", () => {
  it("adds and removes, keeping a primary", () => {
    let s = toggleSpecialization([], null, "hypertrophy");
    expect(s).toEqual({ selected: ["hypertrophy"], primary: "hypertrophy", refused: false });
    s = toggleSpecialization(s.selected, s.primary, "strength");
    expect(s.selected).toEqual(["hypertrophy", "strength"]);
    expect(s.primary).toBe("hypertrophy");
    s = toggleSpecialization(s.selected, s.primary, "hypertrophy");
    expect(s).toEqual({ selected: ["strength"], primary: "strength", refused: false });
    s = toggleSpecialization(s.selected, s.primary, "strength");
    expect(s).toEqual({ selected: [], primary: null, refused: false });
  });
  it("refuses a ninth", () => {
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(toggleSpecialization(eight, "a", "i")).toEqual({ selected: eight, primary: "a", refused: true });
  });
});

describe("services", () => {
  it("parses prices in either decimal style", () => {
    expect(priceToCents("99")).toBe(9900);
    expect(priceToCents("99,5")).toBe(9950);
    expect(priceToCents("99.50")).toBe(9950);
    expect(priceToCents("1 200")).toBe(120000);
    expect(priceToCents("")).toBeNull();
    expect(priceToCents("abc")).toBeUndefined();
    expect(priceToCents("9.999")).toBeUndefined();
    expect(priceToCents("-5")).toBeUndefined();
  });
  it("prints a price back", () => {
    expect(centsToPrice(9900)).toBe("99");
    expect(centsToPrice(9950)).toBe("99.50");
    expect(centsToPrice(null)).toBe("");
  });
  it("formats a price for the reader", () => {
    expect(formatPrice(9900, "EUR", "en")).toBe("€99");
    expect(formatPrice(9950, "RON", "ro")).toMatch(/^99,50\sRON$/);
    expect(formatPrice(null, "EUR", "en")).toBeNull();
    expect(formatPrice(100, null, "en")).toBeNull();
  });
  it("validates a service form", () => {
    expect(serviceErrors({ name: "Online coaching", description: "", price: "99", priceUnit: "month" })).toEqual({});
    expect(serviceErrors({ name: " ", description: "", price: "", priceUnit: "custom" })).toEqual({ name: "REQUIRED" });
    expect(serviceErrors({ name: "x", description: "", price: "", priceUnit: "month" })).toEqual({ price: "REQUIRED" });
    expect(serviceErrors({ name: "x", description: "", price: "ten", priceUnit: "month" })).toEqual({ price: "FORMAT" });
  });
  it("free and on-request take no price; a duration must be a whole number 1..1000 (20261031100000)", () => {
    expect(serviceErrors({ name: "Intro call", description: "", price: "", priceUnit: "free" })).toEqual({});
    expect(serviceErrors({ name: "x", description: "", price: "", priceUnit: "custom" })).toEqual({});
    expect(serviceErrors({ name: "x", description: "", price: "50", priceUnit: "week", durationValue: "60" })).toEqual({});
    expect(serviceErrors({ name: "x", description: "", price: "50", priceUnit: "year", durationValue: "0" })).toEqual({ duration: "FORMAT" });
    expect(serviceErrors({ name: "x", description: "", price: "50", priceUnit: "session", durationValue: "1001" })).toEqual({ duration: "FORMAT" });
    expect(serviceErrors({ name: "x", description: "", price: "-5", priceUnit: "session" })).toEqual({ price: "FORMAT" });
  });
  it("the pricing model is derived from the unit, and each model offers its units", () => {
    expect(pricingOf("free")).toBe("free");
    expect(pricingOf("custom")).toBe("on_request");
    expect(pricingOf("session")).toBe("one_time");
    expect(pricingOf("package")).toBe("one_time");
    expect(["week", "month", "year"].map((u) => pricingOf(u as "week"))).toEqual(["recurring", "recurring", "recurring"]);
    expect(unitsFor("recurring")).toEqual(["week", "month", "year"]);
    expect(unitsFor("one_time")).toEqual(["session", "package"]);
    // every unit belongs to exactly one model, and round-trips
    for (const m of PRICING_MODELS) for (const u of unitsFor(m)) expect(pricingOf(u)).toBe(m);
    expect(takesPrice("free")).toBe(false);
    expect(takesPrice("custom")).toBe(false);
    expect(takesPrice("month")).toBe(true);
  });
  it("parses a duration as typed", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration(" 60 ")).toBe(60);
    expect(parseDuration("12.5")).toBeUndefined();
    expect(parseDuration("abc")).toBeUndefined();
  });
  it("a free active service is not missing a price; a priced one without a price is", () => {
    const withServices = (services: DraftState["services"]) => missingFor({ ...complete, services });
    expect(withServices([{ active: true, priceUnit: "free", priceCents: null }])).not.toContain("SERVICE_PRICE");
    expect(withServices([{ active: true, priceUnit: "week", priceCents: null }])).toContain("SERVICE_PRICE");
  });
  it("reorders without losing anything", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("status", () => {
  it("only a draft is editable", () => {
    expect(statusView("draft")).toMatchObject({ editable: true, action: "continue" });
    expect(statusView("pending_review")).toMatchObject({ editable: false, action: "edit" });
    expect(statusView("published")).toMatchObject({ editable: false, action: "view" });
    expect(statusView("suspended")).toMatchObject({ editable: false, action: null, tone: "risk" });
    // hidden (20261029100000): locked like published; Edit withdraws it, Show is its own button
    expect(statusView("hidden")).toMatchObject({ editable: false, action: "edit", tone: "neutral" });
  });
});

describe("verification (20261101100000)", () => {
  it("only an unverified or rejected coach can ask; pending and verified cannot", () => {
    expect(verificationView("unverified").canRequest).toBe(true);
    expect(verificationView("rejected").canRequest).toBe(true);
    expect(verificationView("pending").canRequest).toBe(false);
    expect(verificationView("verified").canRequest).toBe(false);
  });
  it("a credential is Voinic's word only when an admin verified it", () => {
    const today = "2026-10-06";
    for (const status of ["unverified", "pending", "rejected"] as const) {
      expect(credentialLabel({ verification_status: status, expires_on: null }, today).source).toBe("coach");
    }
    expect(credentialLabel({ verification_status: "verified", expires_on: null }, today).source).toBe("voinic");
  });
  it("an expired credential says so, whoever checked it", () => {
    expect(credentialLabel({ verification_status: "verified", expires_on: "2026-10-05" }, "2026-10-06").expired).toBe(true);
    expect(credentialLabel({ verification_status: "unverified", expires_on: "2026-10-06" }, "2026-10-06").expired).toBe(false);
    expect(credentialLabel({ verification_status: "unverified", expires_on: null }, "2026-10-06").expired).toBe(false);
  });
});
