import { describe, expect, it } from "vitest";
import type { CoachPublicProfile, CoachViewerState } from "./coach-profile";
import {
  attributionParams, coachFormat, coachGateHref, coachIndexable, coachJsonLd, coachPageDescription, coachPageJsonLd, coachPageTitle, coachTeaser,
  coachWhyPoints, startCoachingState, yearsOfExperience, TEASER_ABOUT_CHARS,
} from "./coach-public";

const profile: CoachPublicProfile = {
  id: "p1", user_id: null, slug: "andrei-popescu", display_name: "Andrei Popescu", username: "andrei.popescu",
  avatar_url: "https://res.cloudinary.com/x/a.jpg", cover_url: null,
  headline: "Personal Trainer", about: "I help busy people get strong.\n\nTen years in the gym.",
  coaching_since: 2016, accepting_clients: true, online: true, in_person: true, published_at: "2026-10-01T00:00:00Z",
  followers: 12, stats: { posts: 3, workouts: null, badges: null, fitness_score: null },
  verified: true,
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
    { id: "s1", name: "Online Coaching", description: null, kind: "online_coaching", price_unit: "month", delivery: "online", duration_value: null, duration_unit: null,
      price_public: true, price_cents: 20000, currency: "RON" },
    { id: "s2", name: "VIP", description: null, kind: "personal_training", price_unit: "session", delivery: "in_person", duration_value: 60, duration_unit: "minutes",
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
  it("the CTA follows the last request (20261103100000)", () => {
    const last = (status: "accepted" | "declined" | "cancelled" | "closed", started = false) =>
      viewer({ last_request: { id: "r", status, service_id: null, created_at: "", started } });
    expect(startCoachingState(profile, last("accepted"), { signedIn: true })).toBe("accepted");
    expect(startCoachingState(profile, last("declined"), { signedIn: true })).toBe("contact_again");
    expect(startCoachingState(profile, last("cancelled"), { signedIn: true })).toBe("contact_again");
    expect(startCoachingState(profile, last("closed"), { signedIn: true })).toBe("contact_again");
    // once coaching started the reader is a client, which wins
    expect(startCoachingState(profile, { ...last("accepted", true), is_client: true }, { signedIn: true })).toBe("client");
    // a pending request wins over an older answer
    expect(startCoachingState(profile, { ...last("declined"), pending_request: { id: "p", service_id: null, created_at: "" } }, { signedIn: true }))
      .toBe("pending");
  });
  it("an accepted request is Message coach, even once the coach stops taking clients (20261104100000)", () => {
    const accepted = viewer({ last_request: { id: "r", status: "accepted", service_id: null, created_at: "", started: false } });
    expect(startCoachingState(profile, accepted, { signedIn: true })).toBe("accepted");
    expect(startCoachingState({ ...profile, accepting_clients: false }, accepted, { signedIn: true })).toBe("accepted");
    // no request, or a declined / cancelled one, is never Message coach
    expect(startCoachingState({ ...profile, accepting_clients: false }, viewer(), { signedIn: true })).toBe("not_accepting");
  });
  it("the relationship decides first: active, paused, ended (20261109110000)", () => {
    const rel = (status: "active" | "paused" | "ended") =>
      viewer({ relationship: { id: "t", status, started_at: "", paused_at: null, ended_at: null } });
    expect(startCoachingState(profile, rel("active"), { signedIn: true })).toBe("client");
    expect(startCoachingState(profile, rel("paused"), { signedIn: true })).toBe("paused");
    expect(startCoachingState(profile, rel("ended"), { signedIn: true })).toBe("start_new");
    // an ended coaching with a new request waiting reads as the request, never as coaching
    expect(startCoachingState(profile, { ...rel("ended"), pending_request: { id: "p", service_id: null, created_at: "" } }, { signedIn: true }))
      .toBe("pending");
    // and a full coach cannot be asked again, ended or not
    expect(startCoachingState({ ...profile, accepting_clients: false }, rel("ended"), { signedIn: true })).toBe("not_accepting");
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

describe("the page", () => {
  it("names the format; both is hybrid", () => {
    expect(coachFormat({ online: true, in_person: true })).toBe("hybrid");
    expect(coachFormat({ online: true, in_person: false })).toBe("online");
    expect(coachFormat({ online: false, in_person: true })).toBe("in_person");
    expect(coachFormat({ online: false, in_person: false })).toBeNull();
  });
  it("why-points come only from facts the profile has, strongest first", () => {
    const points = coachWhyPoints({ ...profile, stats: { posts: 3, programs: 2, workouts: null, badges: null, fitness_score: null } },
      new Date("2026-10-05"));
    expect(points).toEqual([
      { kind: "verified" },
      { kind: "experience", years: 10 },
      { kind: "focus", slugs: ["hypertrophy", "strength"] },
      { kind: "services", n: 2 },
      { kind: "programs", n: 2 },
      { kind: "posts", n: 3 },
    ]);
  });
  it("an empty profile makes no claims — nothing at zero, nothing invented", () => {
    const empty = { ...profile, verified: false, badges: [], coaching_since: null, specializations: [], services: [],
      stats: { posts: 0, programs: 0, workouts: null, badges: null, fitness_score: null } };
    expect(coachWhyPoints(empty)).toEqual([]);
    // a preview from the draft has no stats at all
    expect(coachWhyPoints({ ...empty, stats: undefined })).toEqual([]);
  });
  it("a first-year coach shows the year, not \"0 years\"", () => {
    expect(coachWhyPoints({ ...profile, verified: false, coaching_since: 2026 }, new Date("2026-10-05"))[0])
      .toEqual({ kind: "since", year: 2026 });
  });
});

describe("the public directory's foundation (20261107100000)", () => {
  it("a page with the essentials publishing required is indexable; one that lost them is not", () => {
    expect(coachIndexable(profile)).toBe(true);
    expect(coachIndexable({ ...profile, avatar_url: null })).toBe(false);
    expect(coachIndexable({ ...profile, about: "  " })).toBe(false);
    expect(coachIndexable({ ...profile, services: [] })).toBe(false);
    expect(coachIndexable({ ...profile, specializations: [] })).toBe(false);
  });

  it("the anonymous teaser cuts a long about at a word, and keeps the first three services", () => {
    const long = { ...profile, about: "word ".repeat(200).trim(), services: [...profile.services, ...profile.services] };
    const teaser = coachTeaser(long);
    expect(teaser.aboutCut).toBe(true);
    expect(teaser.profile.about!.length).toBeLessThanOrEqual(TEASER_ABOUT_CHARS + 1);
    expect(teaser.profile.about!.endsWith("word…")).toBe(true);
    expect(teaser.profile.services).toHaveLength(3);
    expect(teaser.moreServices).toBe(1);
  });
  it("a short about and few services are left whole", () => {
    const teaser = coachTeaser(profile);
    expect(teaser.aboutCut).toBe(false);
    expect(teaser.profile.about).toBe(profile.about);
    expect(teaser.moreServices).toBe(0);
  });

  it("the gate returns to this exact coach, signing in or signing up", () => {
    expect(coachGateHref("andrei-popescu", "signin")).toBe("/login?next=%2Fcoaches%2Fandrei-popescu");
    expect(coachGateHref("andrei-popescu", "signup")).toBe("/login?next=%2Fcoaches%2Fandrei-popescu&mode=signup");
    // the visit's source rides along, so the new account remembers it (20261110120000)
    expect(coachGateHref("andrei-popescu", "signup", attributionParams({ source: "instagram", medium: "social", campaign: null })))
      .toBe("/login?next=%2Fcoaches%2Fandrei-popescu&mode=signup&utm_source=instagram&utm_medium=social");
    // moving around the app is not a source; no source, no parameters
    expect(attributionParams({ source: "internal", medium: null, campaign: null })).toEqual({});
    expect(attributionParams(null)).toEqual({});
  });

  it("JSON-LD: the profile page and its breadcrumb, from real fields only, no rating", () => {
    const ld = coachPageJsonLd(profile, "https://www.voinic.fit", "ro", { home: "Voinic", coaches: "Antrenori" });
    const [page, crumbs] = ld["@graph"] as Record<string, unknown>[];
    expect(page!["@type"]).toBe("ProfilePage");
    expect(page!.url).toBe("https://www.voinic.fit/coaches/andrei-popescu");
    expect(page!.dateCreated).toBe("2026-10-01T00:00:00Z");
    const person = page!.mainEntity as Record<string, unknown>;
    expect(person["@type"]).toBe("Person");
    expect(person.alternateName).toBe("@andrei.popescu");
    expect(person).not.toHaveProperty("aggregateRating");
    expect(JSON.stringify(ld)).not.toContain("aggregateRating");
    expect((crumbs!.itemListElement as { item: string }[]).map((i) => i.item)).toEqual([
      "https://www.voinic.fit", "https://www.voinic.fit/coaches", "https://www.voinic.fit/coaches/andrei-popescu",
    ]);
    // nothing invented: no price for a service whose price is private
    expect(JSON.stringify(person.makesOffer)).not.toContain('"VIP","price"');
  });
});
