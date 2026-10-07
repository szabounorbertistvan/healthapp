import { describe, expect, it } from "vitest";
import type { MyCoachProfile } from "./coach-profile";
import {
  overlayRevision, revisionDiff, withCertification, withLocations, withService, withServiceOrder, withSpecializations,
  withoutService, type RevisionPayload, type RevisionService,
} from "./coach-revision";

const service = (id: string, over: Partial<RevisionService> = {}): RevisionService => ({
  id, name: `Service ${id}`, description: null, kind: "online_coaching", delivery: "online", duration_value: null,
  duration_unit: null, price_cents: 20000, currency: "RON", price_unit: "month", price_public: true, active: true, sort_order: 0, ...over,
});

const live: RevisionPayload = {
  headline: "Strength coach", about: "Ten years.", coaching_since: 2016, online: true, in_person: false,
  specializations: [{ slug: "strength", is_primary: true }], languages: ["ro"],
  locations: [], services: [service("a"), service("b", { sort_order: 1 })],
  certifications: [{ id: "c1", name: "ISSA", issuer: null, year: 2016, credential_number: null, expires_on: null, sort_order: 0, verification_status: "verified" }],
};

describe("patching the copy", () => {
  it("replaces the specialization set, with its primary", () => {
    expect(withSpecializations(live, ["strength", "mobility"], "mobility").specializations)
      .toEqual([{ slug: "strength", is_primary: false }, { slug: "mobility", is_primary: true }]);
  });
  it("maps the editor's locations to the payload's", () => {
    expect(withLocations(live, [{ city: "cluj-napoca", gymName: " Iron Gym ", gymId: null }]).locations)
      .toEqual([{ city_slug: "cluj-napoca", gym_name: "Iron Gym", gym_id: null }]);
  });
  it("inserts a new service and replaces an existing one in place", () => {
    const added = withService(live, service("new"));
    expect(added.services.map((s) => s.id)).toEqual(["a", "b", "new"]);
    const edited = withService(live, service("a", { name: "Renamed" }));
    expect(edited.services.map((s) => s.name)).toEqual(["Renamed", "Service b"]);
    expect(withoutService(live, "a").services.map((s) => s.id)).toEqual(["b"]);
  });
  it("reorders exactly the copy's services, and refuses any other list", () => {
    expect(withServiceOrder(live, ["b", "a"])!.services.map((s) => [s.id, s.sort_order])).toEqual([["b", 0], ["a", 1]]);
    expect(withServiceOrder(live, ["a"])).toBeNull();
    expect(withServiceOrder(live, ["a", "zzz"])).toBeNull();
  });
  it("an edited certificate keeps its review state in the copy", () => {
    const next = withCertification(live, { id: "c1", name: "ISSA CPT", issuer: "ISSA", year: 2016, credential_number: null, expires_on: null, sort_order: 0 });
    expect(next.certifications[0]!.verification_status).toBe("verified");
  });
});

describe("the editor reads the copy over the live profile", () => {
  it("content from the copy, everything operational from what is live", () => {
    const mine = {
      profile: { id: "p", slug: "ana", status: "published", headline: "Old", about: "Old", coaching_since: 2010, online: false,
                 in_person: true, accepting_clients: true, cover_url: "https://x/c.jpg" },
      specializations: [], languages: [], locations: [{ city_slug: "iasi", gym_name: null, gym_id: null }],
      services: [{ ...service("a"), bookable: true, coach_profile_id: "p" }], certifications: [], verifications: [], missing: [],
    } as unknown as MyCoachProfile;
    const shown = overlayRevision(mine, live);
    expect(shown.profile.headline).toBe("Strength coach");
    expect(shown.profile.slug).toBe("ana");
    expect(shown.profile.cover_url).toBe("https://x/c.jpg");
    expect(shown.profile.status).toBe("published");
    expect(shown.locations).toEqual([]);
    // a service still carries its live booking settings
    expect((shown.services[0] as unknown as { bookable: boolean }).bookable).toBe(true);
    expect(shown.services.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("what changed, for the admin", () => {
  it("nothing when nothing changed", () => {
    expect(revisionDiff(live, live)).toEqual([]);
  });
  it("names each change: fields, sets, added / changed / removed services", () => {
    const next: RevisionPayload = {
      ...withService(withoutService(live, "b"), service("a", { price_cents: 25000 })),
      headline: "Strength & mobility coach",
      services: [service("a", { price_cents: 25000 }), service("n", { name: "Consult", price_unit: "free", price_cents: null })],
    };
    const diff = revisionDiff(live, next);
    expect(diff).toContainEqual({ field: "headline", before: "Strength coach", after: "Strength & mobility coach" });
    expect(diff.find((d) => d.field === "service" && d.change === "changed")).toMatchObject({ name: "Service a" });
    expect(diff.find((d) => d.field === "service" && d.change === "added")).toMatchObject({ name: "Consult" });
    expect(diff.find((d) => d.field === "service" && d.change === "removed")).toMatchObject({ name: "Service b" });
  });
});
