import { describe, expect, it } from "vitest";
import {
  EMPTY_QUERY, clearFilters, discoverySearch, emptyKind, filterChips, hasFilters, hasMore, parseDiscoveryQuery,
  searchArgs, toCoachCard, withChange, type CoachSearchRow, type DiscoveryFacets,
} from "./coach-discovery";

const facets: DiscoveryFacets = {
  specializations: [
    { slug: "hypertrophy", name_en: "Hypertrophy", name_ro: "Hipertrofie" },
    { slug: "weight-loss", name_en: "Weight Loss", name_ro: "Slăbire" },
  ],
  countries: [{ code: "RO", slug: "romania", name_en: "Romania", name_ro: "România", coaches: 2 }],
  cities: [{ slug: "cluj-napoca", name: "Cluj-Napoca", name_en: "Cluj-Napoca", country_code: "RO", coaches: 1 }],
};
const labels = {
  online: "Online", inPerson: "In person", experience: "{n}+ years", priceFrom: "from {price}",
  priceTo: "up to {price}", priceRange: "{min}–{max}", includeFull: "Incl. not accepting",
};

describe("URL state", () => {
  it("an empty URL is the default listing", () => {
    expect(parseDiscoveryQuery({})).toEqual(EMPTY_QUERY);
    expect(discoverySearch(EMPTY_QUERY)).toBe("");
  });
  it("round-trips every filter", () => {
    const url = "?q=hypertrophy&country=romania&city=cluj-napoca&online=true&in_person=true&specialization=hypertrophy&specialization=weight-loss&experience=5&price_min=100&price_max=300&accepting=any&sort=experience&page=2";
    const q = parseDiscoveryQuery(new URLSearchParams(url));
    expect(q).toMatchObject({
      q: "hypertrophy", country: "romania", city: "cluj-napoca", online: true, inPerson: true,
      specializations: ["hypertrophy", "weight-loss"], experience: 5, priceMin: 100, priceMax: 300,
      accepting: false, sort: "experience", page: 2,
    });
    expect(discoverySearch(q)).toBe(url);
  });
  it("accepts comma-separated specializations and drops duplicates", () => {
    expect(parseDiscoveryQuery({ specialization: "hypertrophy,weight-loss,hypertrophy" }).specializations)
      .toEqual(["hypertrophy", "weight-loss"]);
  });
  it("ignores what is malformed", () => {
    const q = parseDiscoveryQuery({ city: "Cluj Napoca!", experience: "4", sort: "best", page: "-3", price_min: "abc", online: "yes" });
    expect(q).toEqual(EMPTY_QUERY);
  });
  it("caps the page", () => {
    expect(parseDiscoveryQuery({ page: "99" }).page).toBe(1);
    expect(parseDiscoveryQuery({ page: "10" }).page).toBe(10);
  });
  it("a change goes back to the first page", () => {
    const q = { ...EMPTY_QUERY, page: 3 };
    expect(withChange(q, { online: true }).page).toBe(1);
    expect(withChange(q, { page: 4 }).page).toBe(4);
  });
});

describe("search arguments", () => {
  it("prices travel in minor units, Load more grows the limit", () => {
    const args = searchArgs({ ...EMPTY_QUERY, priceMin: 100, priceMax: 250, page: 3 });
    expect(args).toMatchObject({ p_price_min: 10000, p_price_max: 25000, p_currency: "RON", p_limit: 72, p_offset: 0 });
  });
  it("unset filters are null, not false", () => {
    expect(searchArgs(EMPTY_QUERY)).toMatchObject({
      p_query: null, p_online: null, p_in_person: null, p_specializations: null, p_accepting: true, p_sort: "recommended",
    });
  });
});

describe("filters", () => {
  it("knows when anything narrows the list", () => {
    expect(hasFilters(EMPTY_QUERY)).toBe(false);
    expect(hasFilters({ ...EMPTY_QUERY, sort: "newest", page: 2 })).toBe(false);
    expect(hasFilters({ ...EMPTY_QUERY, q: "x" })).toBe(true);
    expect(hasFilters({ ...EMPTY_QUERY, accepting: false })).toBe(true);
  });
  it("one chip per filter, each removing only itself", () => {
    const q = { ...EMPTY_QUERY, city: "cluj-napoca", online: true, specializations: ["hypertrophy", "weight-loss"], priceMax: 300 };
    const chips = filterChips(q, facets, "ro", labels);
    expect(chips.map((c) => c.label)).toEqual(["Cluj-Napoca", "Online", "Hipertrofie", "Slăbire", "up to 300 RON"]);
    expect(chips[2]!.remove.specializations).toEqual(["weight-loss"]);
    expect(chips[0]!.remove.city).toBeNull();
    expect(chips[0]!.remove.online).toBe(true);
  });
  it("removing the country removes its city", () => {
    const chips = filterChips({ ...EMPTY_QUERY, country: "romania", city: "cluj-napoca" }, facets, "en", labels);
    expect(chips[0]!.remove).toMatchObject({ country: null, city: null });
  });
  it("clear filters keeps the text and the sort; clear all drops the text", () => {
    const q = { ...EMPTY_QUERY, q: "strength", online: true, sort: "newest" as const };
    expect(clearFilters(q)).toEqual({ ...EMPTY_QUERY, q: "strength", sort: "newest" });
    expect(clearFilters(q, false).q).toBe("");
  });
});

describe("empty states and pages", () => {
  it("tells apart no coaches, no match for filters, no match for a search", () => {
    expect(emptyKind(3, EMPTY_QUERY)).toBe("none");
    expect(emptyKind(0, EMPTY_QUERY)).toBe("no_coaches");
    expect(emptyKind(0, { ...EMPTY_QUERY, q: "zzz" })).toBe("no_match_search");
    expect(emptyKind(0, { ...EMPTY_QUERY, q: "zzz", online: true })).toBe("no_match_filters");
    expect(emptyKind(0, { ...EMPTY_QUERY, city: "cluj-napoca" })).toBe("no_match_filters");
  });
  it("offers Load more only while there is more", () => {
    expect(hasMore(30, EMPTY_QUERY)).toBe(true);
    expect(hasMore(24, EMPTY_QUERY)).toBe(false);
    expect(hasMore(500, { ...EMPTY_QUERY, page: 10 })).toBe(false);
  });
});

describe("card mapping", () => {
  const row: CoachSearchRow = {
    slug: "ana", display_name: "Ana", avatar_url: null, headline: "Strength coach", verified: true,
    online: true, in_person: true, coaching_since: 2016, accepting_clients: true, followers: 12,
    location: { city: "București", city_en: "Bucharest", country_code: "RO" },
    specializations: [{ slug: "strength", name_en: "Strength", name_ro: "Forță" }], specializations_total: 4,
    starting_price: { cents: 20000, currency: "RON", unit: "month" },
  };
  it("maps a row to what the card draws, in the reader's language", () => {
    expect(toCoachCard(row, "ro", new Date("2026-10-01"))).toEqual({
      href: "/coaches/ana", name: "Ana", avatarUrl: null, headline: "Strength coach", verified: true,
      city: "București", formats: ["online", "in_person"], years: 10, specializations: ["Forță"],
      moreSpecializations: 3, startingPrice: { cents: 20000, currency: "RON", unit: "month" }, followers: 12, accepting: true,
    });
    expect(toCoachCard(row, "en").city).toBe("Bucharest");
  });
  it("an online-only coach shows no city, a first-year coach no years", () => {
    const card = toCoachCard({ ...row, in_person: false, coaching_since: 2026 }, "en", new Date("2026-10-01"));
    expect(card.city).toBeNull();
    expect(card.formats).toEqual(["online"]);
    expect(card.years).toBeNull();
  });
});
