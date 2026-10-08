import { describe, expect, it } from "vitest";
import type { MyCoachProfile } from "./coach-profile";
import { marketplaceState, profileCompleteness } from "./coach-completeness";

type Mine = Pick<MyCoachProfile, "profile" | "specializations" | "languages" | "locations" | "services" | "certifications">;

const empty: Mine = {
  profile: { headline: null, about: null, coaching_since: null, online: false, in_person: false, verification_status: "unverified" } as Mine["profile"],
  specializations: [], languages: [], locations: [], services: [], certifications: [],
};
const full: Mine = {
  profile: { headline: "Strength coach", about: "x".repeat(200), coaching_since: 2016, online: true, in_person: true,
             verification_status: "verified", approach: "y".repeat(120) } as Mine["profile"],
  specializations: [{ slug: "strength", is_primary: true }], languages: ["ro"],
  locations: [{ city_slug: "cluj-napoca", gym_name: null, gym_id: null }],
  services: [{ id: "s", active: true, price_public: true, price_cents: 15000, price_unit: "session" } as Mine["services"][number]],
  certifications: [{ id: "c" } as Mine["certifications"][number]],
};
const extrasFull = { hasAvatar: true, availabilityBlocks: 3, bookableServices: 1 };
const extrasNone = { hasAvatar: false, availabilityBlocks: 0, bookableServices: 0 };

describe("profile completeness", () => {
  it("an empty profile is 0 %, and the next steps are the required ones first", () => {
    const c = profileCompleteness(empty, extrasNone);
    expect(c.pct).toBe(0);
    expect(c.next.slice(0, 6).every((i) => i.required)).toBe(true);
    // the biggest required gain first (bio, 12), then ties in checklist order
    expect(c.next.slice(0, 2).map((i) => i.key)).toEqual(["bio", "photo"]);
  });
  it("everything there is 100 %", () => {
    expect(profileCompleteness(full, extrasFull).pct).toBe(100);
  });
  it("is not easy to game: a one-line bio earns a third of its weight", () => {
    const c = profileCompleteness({ ...full, profile: { ...full.profile, about: "Hi." } }, extrasFull);
    expect(c.pct).toBe(92);
    expect(c.items.find((i) => i.key === "bio")).toMatchObject({ done: false, earned: 4 });
  });
  it("weekly hours count only with a bookable service", () => {
    expect(profileCompleteness(full, { ...extrasFull, bookableServices: 0 }).pct).toBe(90);
    expect(profileCompleteness(full, { ...extrasFull, availabilityBlocks: 0 }).pct).toBe(90);
  });
  it("coaching in person needs a place; online alone does not", () => {
    const inPerson = { ...full, profile: { ...full.profile, online: false, in_person: true }, locations: [] };
    expect(profileCompleteness(inPerson, extrasFull).items.find((i) => i.key === "location")!.done).toBe(false);
    const online = { ...full, profile: { ...full.profile, online: true, in_person: false }, locations: [] };
    expect(profileCompleteness(online, extrasFull).items.find((i) => i.key === "location")!.done).toBe(true);
  });
  it("an inactive service is not an offer", () => {
    const off = { ...full, services: [{ id: "s", active: false } as Mine["services"][number]] };
    expect(profileCompleteness(off, extrasFull).items.find((i) => i.key === "services")!.done).toBe(false);
  });
  it("a public price counts; price on request or hidden does not, a free offer does (20261111100000)", () => {
    const svc = (x: object) => ({ ...full, services: [{ id: "s", active: true, ...x } as Mine["services"][number]] });
    expect(profileCompleteness(svc({ price_public: true, price_cents: null, price_unit: "custom" }), extrasFull).pct).toBe(95);
    expect(profileCompleteness(svc({ price_public: false, price_cents: 10000, price_unit: "session" }), extrasFull).pct).toBe(95);
    expect(profileCompleteness(svc({ price_public: true, price_cents: null, price_unit: "free" }), extrasFull).pct).toBe(100);
  });
  it("a coaching approach counts from a real sentence", () => {
    const withApproach = (approach: string | null) => ({ ...full, profile: { ...full.profile, approach } });
    expect(profileCompleteness(withApproach(null), extrasFull).pct).toBe(95);
    expect(profileCompleteness(withApproach("Hard work."), extrasFull).items.find((i) => i.key === "approach")!.done).toBe(false);
    expect(profileCompleteness(withApproach("z".repeat(80)), extrasFull).pct).toBe(100);
  });
  it("weights add up to 100 and the required set mirrors publishing", () => {
    const c = profileCompleteness(empty, extrasNone);
    expect(c.items.reduce((n, i) => n + i.weight, 0)).toBe(100);
    expect(c.items.filter((i) => i.required).map((i) => i.key).sort())
      .toEqual(["bio", "location", "photo", "services", "specializations", "title"]);
  });
});

describe("marketplace state", () => {
  it("a draft with nothing missing is ready — not public, an admin still approves", () => {
    expect(marketplaceState("draft", [])).toBe("ready");
    expect(marketplaceState("draft", ["AVATAR"])).toBe("draft");
    expect(marketplaceState("published", [])).toBe("published");
    expect(marketplaceState("pending_review", [])).toBe("pending_review");
  });
});
