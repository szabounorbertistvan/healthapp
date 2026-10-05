/**
 * Coach Discovery (/coaches): the search state as it lives in the URL, the
 * RPC arguments it becomes, the filter chips it shows, and the card each
 * search_coaches() row turns into. Pure — unit-tested in
 * lib/coach-discovery.test.ts and shared by the page and its client controls.
 *
 * The URL is the state: refresh keeps the search, a link shares it, back and
 * forward walk it. Defaults are left out of the URL so one search has one
 * address.
 */
import type { PriceUnit } from "./coach-profile";

export const DISCOVERY_PAGE_SIZE = 24;
/** "Load more" grows the page this far (the RPC refuses offsets past 1000). */
export const DISCOVERY_MAX_PAGES = 10;
export const EXPERIENCE_STEPS = [1, 3, 5, 10] as const;
export const DISCOVERY_SORTS = ["recommended", "relevance", "experience", "followers", "newest"] as const;
export type DiscoverySort = (typeof DISCOVERY_SORTS)[number];
/** Prices are filtered in one currency; the market is Romania. */
export const DISCOVERY_CURRENCY = "RON";

export type DiscoveryQuery = {
  q: string;
  country: string | null;
  city: string | null;
  /** An active gym's id (coach_discovery_facets().gyms) — a coach with a location there. */
  gym: string | null;
  online: boolean;
  inPerson: boolean;
  /** Both online and in person, on top of the two format ticks. */
  hybrid: boolean;
  specializations: string[];
  experience: number | null;
  /** Only coaches with an accepted verification (the ✓ on a card). */
  verified: boolean;
  /** Whole currency units, as typed. */
  priceMin: number | null;
  priceMax: number | null;
  /** True (the default): only coaches taking clients. False: everyone published. */
  accepting: boolean;
  sort: DiscoverySort;
  /** 1-based; page N shows the first N × 24 (Load more). */
  page: number;
  /**
   * The full listing with nothing narrowing it (`?all=1`). Without it, an
   * unfiltered /coaches is the Discovery Home instead. Not a filter: it only
   * picks the layout, and any search or filter implies the listing anyway.
   */
  browse: boolean;
};

export const EMPTY_QUERY: DiscoveryQuery = {
  q: "", country: null, city: null, gym: null, online: false, inPerson: false, hybrid: false, specializations: [],
  experience: null, verified: false, priceMin: null, priceMax: null, accepting: true, sort: "recommended", page: 1, browse: false,
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function all(params: Params, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const v = params[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
const one = (params: Params, key: string) => all(params, key)[0];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const slugOrNull = (v: string | undefined) => {
  const s = v?.trim().toLowerCase();
  return s && SLUG.test(s) && s.length <= 60 ? s : null;
};
const positiveInt = (v: string | undefined, max: number) => {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
};

/** Anything a URL may carry → a valid query; unknown or malformed values fall back to the default. */
export function parseDiscoveryQuery(params: Params): DiscoveryQuery {
  const specs = all(params, "specialization").flatMap((v) => v.split(","))
    .map((s) => slugOrNull(s)).filter((s): s is string => Boolean(s));
  const sort = one(params, "sort");
  const experience = positiveInt(one(params, "experience"), 60);
  return {
    q: (one(params, "q") ?? "").trim().slice(0, 100),
    country: slugOrNull(one(params, "country")),
    city: slugOrNull(one(params, "city")),
    gym: UUID.test(one(params, "gym")?.trim().toLowerCase() ?? "") ? one(params, "gym")!.trim().toLowerCase() : null,
    online: one(params, "online") === "true",
    inPerson: one(params, "in_person") === "true",
    hybrid: one(params, "hybrid") === "true",
    specializations: [...new Set(specs)].slice(0, 12),
    experience: experience && (EXPERIENCE_STEPS as readonly number[]).includes(experience) ? experience : null,
    verified: one(params, "verified") === "true",
    priceMin: positiveInt(one(params, "price_min"), 1_000_000),
    priceMax: positiveInt(one(params, "price_max"), 1_000_000),
    accepting: one(params, "accepting") !== "any",
    sort: (DISCOVERY_SORTS as readonly string[]).includes(sort ?? "") ? (sort as DiscoverySort) : "recommended",
    page: Math.min(positiveInt(one(params, "page"), DISCOVERY_MAX_PAGES) ?? 1, DISCOVERY_MAX_PAGES),
    browse: one(params, "all") === "1",
  };
}

/** The query → its canonical URL search string ("" for the default listing). Stable key order. */
export function discoverySearch(query: DiscoveryQuery): string {
  const p = new URLSearchParams();
  if (query.q.trim()) p.set("q", query.q.trim());
  if (query.country) p.set("country", query.country);
  if (query.city) p.set("city", query.city);
  if (query.gym) p.set("gym", query.gym);
  if (query.online) p.set("online", "true");
  if (query.inPerson) p.set("in_person", "true");
  if (query.hybrid) p.set("hybrid", "true");
  for (const s of query.specializations) p.append("specialization", s);
  if (query.experience) p.set("experience", String(query.experience));
  if (query.verified) p.set("verified", "true");
  if (query.priceMin) p.set("price_min", String(query.priceMin));
  if (query.priceMax) p.set("price_max", String(query.priceMax));
  if (!query.accepting) p.set("accepting", "any");
  // a search or a filter already means the listing; `all` only marks the bare one
  if (query.browse && !hasFilters(query)) p.set("all", "1");
  if (query.sort !== "recommended") p.set("sort", query.sort);
  if (query.page > 1) p.set("page", String(query.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** A change to the search starts again from the first page. */
export function withChange(query: DiscoveryQuery, change: Partial<DiscoveryQuery>): DiscoveryQuery {
  return { ...query, ...change, page: "page" in change ? change.page! : 1 };
}

/** Is anything narrowing the list (search text or a filter)? Sort, page and browse are not filters. */
export function hasFilters(query: DiscoveryQuery): boolean {
  const { sort: _s, page: _p, browse: _b, ...rest } = query;
  const { sort: _ds, page: _dp, browse: _db, ...base } = EMPTY_QUERY;
  return JSON.stringify(rest) !== JSON.stringify(base);
}

/**
 * /coaches with nothing asked for is the Discovery Home (hero, quick filters,
 * recommended, near you, specialties); anything else is the listing.
 */
export function isDiscoveryHome(query: DiscoveryQuery): boolean {
  return !hasFilters(query) && !query.browse && query.sort === "recommended" && query.page === 1;
}

/**
 * search_coaches() arguments. Prices travel in minor units. The three
 * 20261027100000 filters are sent only when set: an unfiltered call stays
 * valid against the previous signature too, so the page never depends on
 * the order a deploy and a migration land in.
 */
export function searchArgs(query: DiscoveryQuery) {
  return {
    p_query: query.q || null,
    p_country: query.country,
    p_city: query.city,
    p_online: query.online || null,
    p_in_person: query.inPerson || null,
    p_specializations: query.specializations.length ? query.specializations : null,
    p_min_years: query.experience,
    p_price_min: query.priceMin !== null ? query.priceMin * 100 : null,
    p_price_max: query.priceMax !== null ? query.priceMax * 100 : null,
    p_currency: DISCOVERY_CURRENCY,
    p_accepting: query.accepting,
    p_sort: query.sort,
    p_limit: DISCOVERY_PAGE_SIZE * query.page,
    p_offset: 0,
    ...(query.verified ? { p_verified: true } : {}),
    ...(query.hybrid ? { p_hybrid: true } : {}),
    ...(query.gym ? { p_gym: query.gym } : {}),
  };
}

// ---------- facets and chips ----------

export type DiscoveryFacets = {
  specializations: { slug: string; name_en: string; name_ro: string }[];
  countries: { code: string; slug: string; name_en: string; name_ro: string; coaches: number }[];
  cities: { slug: string; name: string; name_en: string; country_code: string; coaches: number }[];
  /** Active gyms with a published coach (20261027100000); `city` is a city slug. */
  gyms: { id: string; name: string; city: string; coaches: number }[];
};

export type FilterChip = { key: string; label: string; remove: DiscoveryQuery };

export type ChipLabels = {
  online: string;
  inPerson: string;
  hybrid: string;
  verified: string;
  experience: string; // "{n}+ years"
  priceFrom: string;  // "from {price}"
  priceTo: string;    // "up to {price}"
  priceRange: string; // "{min}–{max}"
  includeFull: string;
};

const fillN = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));

/**
 * One removable chip per active filter, in the order the filters panel lists
 * them. Removing the last one stays in the listing (?all=1), like Clear all.
 */
export function filterChips(current: DiscoveryQuery, facets: DiscoveryFacets, locale: "en" | "ro", labels: ChipLabels): FilterChip[] {
  const query = { ...current, browse: true };
  const chips: FilterChip[] = [];
  const name = (x: { name_en: string; name_ro: string }) => (locale === "ro" ? x.name_ro : x.name_en);
  if (query.country) {
    const c = facets.countries.find((x) => x.slug === query.country);
    chips.push({ key: `country:${query.country}`, label: c ? name(c) : query.country, remove: withChange(query, { country: null, city: null, gym: null }) });
  }
  if (query.city) {
    const c = facets.cities.find((x) => x.slug === query.city);
    chips.push({ key: `city:${query.city}`, label: c ? (locale === "ro" ? c.name : c.name_en) : query.city, remove: withChange(query, { city: null, gym: null }) });
  }
  if (query.gym) {
    const g = facets.gyms.find((x) => x.id === query.gym);
    chips.push({ key: "gym", label: g ? g.name : "…", remove: withChange(query, { gym: null }) });
  }
  if (query.online) chips.push({ key: "online", label: labels.online, remove: withChange(query, { online: false }) });
  if (query.inPerson) chips.push({ key: "in_person", label: labels.inPerson, remove: withChange(query, { inPerson: false }) });
  if (query.hybrid) chips.push({ key: "hybrid", label: labels.hybrid, remove: withChange(query, { hybrid: false }) });
  for (const slug of query.specializations) {
    const s = facets.specializations.find((x) => x.slug === slug);
    chips.push({
      key: `spec:${slug}`, label: s ? name(s) : slug,
      remove: withChange(query, { specializations: query.specializations.filter((x) => x !== slug) }),
    });
  }
  if (query.experience) {
    chips.push({ key: "experience", label: fillN(labels.experience, { n: query.experience }), remove: withChange(query, { experience: null }) });
  }
  if (query.verified) chips.push({ key: "verified", label: labels.verified, remove: withChange(query, { verified: false }) });
  if (query.priceMin !== null || query.priceMax !== null) {
    const label = query.priceMin !== null && query.priceMax !== null
      ? fillN(labels.priceRange, { min: query.priceMin, max: query.priceMax })
      : query.priceMin !== null ? fillN(labels.priceFrom, { price: query.priceMin }) : fillN(labels.priceTo, { price: query.priceMax! });
    chips.push({ key: "price", label: `${label} ${DISCOVERY_CURRENCY}`, remove: withChange(query, { priceMin: null, priceMax: null }) });
  }
  if (!query.accepting) chips.push({ key: "accepting", label: labels.includeFull, remove: withChange(query, { accepting: true }) });
  return chips;
}

/**
 * Everything off but the text and the sort; or everything off ("Clear all" vs
 * "Clear filters"). Clearing stays in the listing (?all=1): the reader asked
 * to see every coach, not to be sent back to the Discovery Home.
 */
export function clearFilters(query: DiscoveryQuery, keepText = true): DiscoveryQuery {
  return { ...EMPTY_QUERY, q: keepText ? query.q : "", sort: query.sort, browse: true };
}

// ---------- results ----------

/** A search_coaches() item, as the RPC returns it. */
export type CoachSearchRow = {
  slug: string;
  display_name: string;
  avatar_url: string | null;
  headline: string | null;
  verified: boolean;
  online: boolean;
  in_person: boolean;
  coaching_since: number | null;
  accepting_clients: boolean;
  followers: number;
  location: { city: string; city_en: string; country_code: string } | null;
  specializations: { slug: string; name_en: string; name_ro: string }[];
  specializations_total: number;
  starting_price: { cents: number; currency: string; unit: PriceUnit } | null;
  // for a signed-in caller only (20261026100000); absent for anyone else
  user_id?: string;
  is_self?: boolean;
  is_following?: boolean;
  follows_me?: boolean;
};
export type CoachSearchResult = { total: number; items: CoachSearchRow[] };

/** What a CoachCard draws — already in the reader's language. */
export type CoachCardModel = {
  href: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  verified: boolean;
  city: string | null;
  formats: ("online" | "in_person")[];
  years: number | null;
  specializations: string[];
  moreSpecializations: number;
  startingPrice: { cents: number; currency: string; unit: PriceUnit } | null;
  followers: number;
  accepting: boolean;
  /**
   * What the card's Follow button needs — set only when the search ran for a
   * signed-in reader and the card is not their own. Null otherwise: an
   * anonymous reader gets a sign-in link, the coach themselves nothing.
   */
  follow: { userId: string; following: boolean; followsMe: boolean } | null;
  isSelf: boolean;
};

export function toCoachCard(row: CoachSearchRow, locale: "en" | "ro", now = new Date()): CoachCardModel {
  const years = row.coaching_since ? now.getFullYear() - row.coaching_since : null;
  return {
    href: `/coaches/${row.slug}`,
    name: row.display_name,
    avatarUrl: row.avatar_url,
    headline: row.headline,
    verified: row.verified,
    // a city only means something for in-person coaching
    city: row.in_person && row.location ? (locale === "ro" ? row.location.city : row.location.city_en) : null,
    formats: [row.online ? "online" as const : null, row.in_person ? "in_person" as const : null].filter((f): f is "online" | "in_person" => Boolean(f)),
    years: years && years > 0 ? years : null,
    specializations: row.specializations.map((s) => (locale === "ro" ? s.name_ro : s.name_en)),
    moreSpecializations: Math.max(0, row.specializations_total - row.specializations.length),
    startingPrice: row.starting_price,
    followers: row.followers,
    accepting: row.accepting_clients,
    follow: row.user_id && !row.is_self
      ? { userId: row.user_id, following: row.is_following === true, followsMe: row.follows_me === true }
      : null,
    isSelf: row.is_self === true,
  };
}

/**
 * Which empty state to show: nobody published at all, nothing for these
 * filters (offer Clear filters), or nothing for the typed text (suggest
 * other words).
 */
export function emptyKind(total: number, query: DiscoveryQuery): "none" | "no_coaches" | "no_match_filters" | "no_match_search" {
  if (total > 0) return "none";
  if (!hasFilters(query)) return "no_coaches";
  const { q: _q, ...withoutText } = query;
  const { q: _eq, ...emptyWithoutText } = EMPTY_QUERY;
  const norm = { sort: "recommended", page: 1, browse: false };
  const onlyText = JSON.stringify({ ...withoutText, ...norm }) === JSON.stringify({ ...emptyWithoutText, ...norm });
  return onlyText ? "no_match_search" : "no_match_filters";
}

/** Load more: is there another page to grow into? */
export function hasMore(total: number, query: DiscoveryQuery): boolean {
  return total > DISCOVERY_PAGE_SIZE * query.page && query.page < DISCOVERY_MAX_PAGES;
}

// ---------- Discovery Home ----------

/** The quick-filter specializations, in this order, when the catalog has them. */
export const QUICK_SPECIALIZATIONS = ["strength", "muscle-building", "weight-loss", "nutrition"] as const;

/** Lower case, no diacritics, one space between words: "  Cluj-Napoca " → "cluj napoca", "Iași" → "iasi". */
export function normalizePlace(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The city in a reader's profile (users.city — free text, nothing keyed on
 * it) → one of the cities that has a published coach, or null. An exact name
 * first (either language, or the slug); otherwise "Cluj" for "Cluj-Napoca"
 * when exactly one city starts with it. Never a guess between two: no match
 * is better than the wrong city.
 */
export function matchViewerCity<C extends DiscoveryFacets["cities"][number]>(city: string | null | undefined, cities: C[]): C | null {
  const want = normalizePlace(city ?? "");
  if (!want) return null;
  const names = (c: C) => [c.name, c.name_en, c.slug].map(normalizePlace);
  const exact = cities.filter((c) => names(c).includes(want));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const prefix = cities.filter((c) => names(c).some((n) => n.startsWith(`${want} `)));
  return prefix.length === 1 ? prefix[0] : null;
}
