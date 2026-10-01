import { describe, expect, it } from "vitest";
import type { CoachPublicProfile, CoachViewerState } from "./coach-profile";
import {
  coachJsonLd, coachPageDescription, coachPageTitle, startCoachingState, yearsOfExperience,
} from "./coach-public";

const profile: CoachPublicProfile = {
  id: "p1", user_id: null, slug: "andrei-popescu", display_name: "Andrei Popescu", username: "andrei.popescu",
  avatar_url: "https://res.cloudinary.com/x/a.jpg", cover_url: null,
  headline: "Personal Trainer", about: "I help busy people get strong.\n\nTen years in the gym.",
  coaching_since: 2016, accepting_clients: true, online: true, in_person: true, published_at: "2026-10-01T00:00:00Z",
  followers: 12, stats: { posts: 3, workouts: null, badges: null, fitness_score: null },
  badges: ["identity_verified"],
  specializations: [
    { slug: "hypertrophy", name_en: "Hypertrophy", name_ro: "Hipertrofie", is_primary: true },
    { slug: "strength", name_en: "Strength", name_ro: "Forță", is_primary: false },
  ],
  languages: [{ code: "ro", name_en: "Romanian", name_ro: "Română", native_name: "Română" }],
  locations: [{ city_slug: "cluj-napoca", city: "Cluj-Napoca", city_en: "Cluj-Napoca", country_code: "RO",
    country_en: "Romania", country_ro: "România", gym_name: "Iron Gym" }],
  certifications: [{ name: "ISSA CPT", issuer: "ISSA", year: 2016, verified: true }],
  services: [
    { id: "s1", name: "Online Coaching", description: null, kind: "online_coaching", price_unit: "month",
      price_public: true, price_cents: 20000, currency: "RON" },
    { id: "s2", name: "VIP", description: null, kind: "personal_training", price_unit: "session",
      price_public: false, price_cents: null, currency: null },
  ],
};

const viewer = (over: Partial<CoachViewerState> = {}): CoachViewerState => ({
  is_self: false, is_following: false, follows_me: false, is_client: false, has_other_coach: false,
  pending_request: null, ...over,
});

describe("start coaching state", () => {
  it("an anonymous reader is asked to sign in", () => {
    expect(startCoachingState(profile, null, { signedIn: false })).toBe("sign_in");
  });
  it("a signed-in reader may ask", () => {
    expect(startCoachingState(profile, viewer(), { signedIn: true })).toBe("available");
  });
  it("the coach's own page, an existing client and a pending request each have their own state", () => {
    expect(startCoachingState(profile, viewer({ is_self: true }), { signedIn: true })).toBe("self");
    expect(startCoachingState(profile, viewer({ is_client: true }), { signedIn: true })).toBe("client");
    expect(startCoachingState(profile, viewer({ pending_request: { id: "r", service_id: null, created_at: "" } }), { signedIn: true }))
      .toBe("pending");
  });
  it("a coach who is not accepting blocks the request, signed in or not", () => {
    const full = { ...profile, accepting_clients: false };
    expect(startCoachingState(full, viewer(), { signedIn: true })).toBe("not_accepting");
    expect(startCoachingState(full, null, { signedIn: false })).toBe("not_accepting");
  });
  it("the preview never goes live", () => {
    expect(startCoachingState(profile, viewer(), { preview: true, signedIn: true })).toBe("preview");
  });
});

describe("experience", () => {
  it("counts whole years and hides a first year", () => {
    expect(yearsOfExperience(2016, new Date("2026-10-01"))).toBe(10);
    expect(yearsOfExperience(2026, new Date("2026-10-01"))).toBeNull();
    expect(yearsOfExperience(null)).toBeNull();
  });
});

describe("metadata", () => {
  it("titles the page with name, role and city", () => {
    expect(coachPageTitle(profile, "en", "Voinic")).toBe("Andrei Popescu — Personal Trainer in Cluj-Napoca | Voinic");
    expect(coachPageTitle(profile, "ro", "Voinic")).toBe("Andrei Popescu — Personal Trainer în Cluj-Napoca | Voinic");
  });
  it("falls back to a generic role and to online", () => {
    const online = { ...profile, headline: null, in_person: false, locations: [] };
    expect(coachPageTitle(online, "ro", "Voinic")).toBe("Andrei Popescu — Antrenor personal · Coaching online | Voinic");
  });
  it("describes the coach from public fields, under 160 characters", () => {
    const d = coachPageDescription(profile, "en");
    expect(d.startsWith("Andrei Popescu, Personal Trainer — Hypertrophy, Strength.")).toBe(true);
    expect(d).toContain("in Cluj-Napoca");
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).not.toContain("\n");
  });
  it("structured data carries offers, prices only where public, and no e-mail", () => {
    const ld = coachJsonLd(profile, "https://www.voinic.fit/coaches/andrei-popescu", "en");
    expect(ld["@type"]).toBe("ProfilePage");
    const person = ld.mainEntity as Record<string, unknown>;
    expect(person.name).toBe("Andrei Popescu");
    const offers = person.makesOffer as Record<string, unknown>[];
    expect(offers[0]).toMatchObject({ name: "Online Coaching", price: "200.00", priceCurrency: "RON" });
    expect(offers[1]).not.toHaveProperty("price");
    expect(JSON.stringify(ld)).not.toContain("@coach");
  });
});
