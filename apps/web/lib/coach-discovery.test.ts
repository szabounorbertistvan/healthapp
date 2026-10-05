import { describe, expect, it } from "vitest";
import {
  EMPTY_QUERY, clearFilters, discoverySearch, emptyKind, filterChips, hasFilters, hasMore, isDiscoveryHome, matchViewerCity,
  normalizePlace, parseDiscoveryQuery, searchArgs, toCoachCard, withChange, type CoachSearchRow, type DiscoveryFacets,
} from "./coach-discovery";

const facets: DiscoveryFacets = {
  specializations: [
    { slug: "hypertrophy", name_en: "Hypertrophy", name_ro: "Hipertrofie" },
    { slug: "weight-loss", name_en: "Weight Loss", name_ro: "Slăbire" },
  ],
  countries: [{ code: "RO", slug: "romania", name_en: "Romania", name_ro: "România", coaches: 2 }],
  cities: [{ slug: "cluj-napoca", name: "Cluj-Napoca", name_en: "Cluj-Napoca", country_code: "RO", coaches: 1 }],
  gyms: [{ id: "0f0f0f0f-1111-4222-8333-444444444444", name: "Iron Temple", city: "cluj-napoca", coaches: 1 }],
};
const labels = {
  online: "Online", inPerson: "In person", hybrid: "Hybrid", verified: "Verified", experience: "{n}+ years", priceFrom: "from {price}",
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
    expect(clearFilters(q)).toEqual({ ...EMPTY_QUERY, q: "strength", sort: "newest", browse: true });
    expect(clearFilters(q, false).q).toBe("");
  });
  it("removing the last chip stays in the listing too", () => {
    const [chip] = filterChips({ ...EMPTY_QUERY, online: true }, facets, "en", labels);
    expect(discoverySearch(chip!.remove)).toBe("?all=1");
  });
  it("clearing stays in the listing, never back to the home", () => {
    const cleared = clearFilters({ ...EMPTY_QUERY, online: true }, false);
    expect(isDiscoveryHome(cleared)).toBe(false);
    expect(discoverySearch(cleared)).toBe("?all=1");
  });
});

describe("verified, hybrid, gym (20261027100000)", () => {
  it("round-trip through the URL", () => {
    const url = `?city=cluj-napoca&gym=0f0f0f0f-1111-4222-8333-444444444444&hybrid=true&verified=true`;
    const q = parseDiscoveryQuery(new URLSearchParams(url));
    expect(q).toMatchObject({ city: "cluj-napoca", gym: "0f0f0f0f-1111-4222-8333-444444444444", hybrid: true, verified: true });
    expect(discoverySearch(q)).toBe(url);
  });
  it("a malformed gym id is dropped", () => {
    expect(parseDiscoveryQuery({ gym: "not-a-uuid" }).gym).toBeNull();
    expect(parseDiscoveryQuery({ gym: "' or 1=1 --" }).gym).toBeNull();
  });
  it("become RPC arguments, sent only when set (an unfiltered call fits the older signature)", () => {
    expect(searchArgs({ ...EMPTY_QUERY, verified: true, hybrid: true, gym: "0f0f0f0f-1111-4222-8333-444444444444" }))
      .toMatchObject({ p_verified: true, p_hybrid: true, p_gym: "0f0f0f0f-1111-4222-8333-444444444444" });
    const args = searchArgs(EMPTY_QUERY);
    expect("p_verified" in args || "p_hybrid" in args || "p_gym" in args).toBe(false);
  });
  it("each is a filter with its own chip", () => {
    const q = { ...EMPTY_QUERY, city: "cluj-napoca", gym: "0f0f0f0f-1111-4222-8333-444444444444", hybrid: true, verified: true };
    expect(hasFilters({ ...EMPTY_QUERY, verified: true })).toBe(true);
    const chips = filterChips(q, facets, "en", labels);
    expect(chips.map((c) => c.label)).toEqual(["Cluj-Napoca", "Iron Temple", "Hybrid", "Verified"]);
    expect(chips[1]!.remove).toMatchObject({ gym: null, city: "cluj-napoca", hybrid: true });
    // a gym belongs to its city: removing the city removes the gym
    expect(chips[0]!.remove).toMatchObject({ city: null, gym: null });
  });
  it("combined filters all travel together, and a change goes back to page 1", () => {
    const q = withChange({ ...EMPTY_QUERY, q: "alex", specializations: ["hypertrophy"], online: true, page: 3 }, { verified: true });
    expect(q.page).toBe(1);
    expect(discoverySearch(q)).toBe("?q=alex&online=true&specialization=hypertrophy&verified=true");
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
      follow: null, isSelf: false,
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

describe("follow on a card (20261026100000)", () => {
  const row: CoachSearchRow = {
    slug: "ana", display_name: "Ana", avatar_url: null, headline: null, verified: false, online: true, in_person: false,
    coaching_since: null, accepting_clients: true, followers: 0, location: null, specializations: [], specializations_total: 0,
    starting_price: null,
  };
  it("an anonymous search carries no follow target", () => {
    expect(toCoachCard(row, "en").follow).toBeNull();
  });
  it("a signed-in search does, with the reader's state", () => {
    expect(toCoachCard({ ...row, user_id: "u1", is_self: false, is_following: true, follows_me: false }, "en").follow)
      .toEqual({ userId: "u1", following: true, followsMe: false });
  });
  it("never on your own card", () => {
    const card = toCoachCard({ ...row, user_id: "me", is_self: true, is_following: false, follows_me: false }, "en");
    expect(card.follow).toBeNull();
    expect(card.isSelf).toBe(true);
  });
});

describe("Discovery Home", () => {
  it("is /coaches with nothing asked for", () => {
    expect(isDiscoveryHome(EMPTY_QUERY)).toBe(true);
    expect(isDiscoveryHome(parseDiscoveryQuery({ q: "cluj" }))).toBe(false);
    expect(isDiscoveryHome(parseDiscoveryQuery({ online: "true" }))).toBe(false);
    expect(isDiscoveryHome(parseDiscoveryQuery({ sort: "newest" }))).toBe(false);
  });
  it("?all=1 is the bare listing, and only it carries the flag", () => {
    const all = parseDiscoveryQuery({ all: "1" });
    expect(all.browse).toBe(true);
    expect(isDiscoveryHome(all)).toBe(false);
    expect(hasFilters(all)).toBe(false);
    expect(discoverySearch(all)).toBe("?all=1");
    // a filter already means the listing: no `all` next to it
    expect(discoverySearch(withChange(all, { online: true }))).toBe("?online=true");
    expect(emptyKind(0, all)).toBe("no_coaches");
  });
});

describe("the reader's city", () => {
  const cities: DiscoveryFacets["cities"] = [
    { slug: "cluj-napoca", name: "Cluj-Napoca", name_en: "Cluj-Napoca", country_code: "RO", coaches: 2 },
    { slug: "bucharest", name: "București", name_en: "Bucharest", country_code: "RO", coaches: 3 },
    { slug: "iasi", name: "Iași", name_en: "Iasi", country_code: "RO", coaches: 1 },
    { slug: "targu-mures", name: "Târgu Mureș", name_en: "Targu Mures", country_code: "RO", coaches: 1 },
    { slug: "targu-jiu", name: "Târgu Jiu", name_en: "Targu Jiu", country_code: "RO", coaches: 1 },
  ];
  it("normalises case, diacritics and punctuation", () => {
    expect(normalizePlace("  Cluj-Napoca ")).toBe("cluj napoca");
    expect(normalizePlace("IAȘI")).toBe("iasi");
  });
  it("matches either language, without diacritics", () => {
    expect(matchViewerCity("Bucuresti", cities)?.slug).toBe("bucharest");
    expect(matchViewerCity("bucharest", cities)?.slug).toBe("bucharest");
    expect(matchViewerCity("Iasi", cities)?.slug).toBe("iasi");
  });
  it("a unique prefix is enough, an ambiguous one is not", () => {
    expect(matchViewerCity("Cluj", cities)?.slug).toBe("cluj-napoca");
    expect(matchViewerCity("Targu", cities)).toBeNull();
  });
  it("nothing typed, or a city without coaches, is no match", () => {
    expect(matchViewerCity(null, cities)).toBeNull();
    expect(matchViewerCity("  ", cities)).toBeNull();
    expect(matchViewerCity("Oradea", cities)).toBeNull();
    expect(matchViewerCity("Clu", cities)).toBeNull();
  });
});
