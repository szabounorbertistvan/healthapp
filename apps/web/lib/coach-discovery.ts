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
import { SERVICE_KINDS, type PriceUnit, type ServiceKind } from "./coach-profile";

export const DISCOVERY_PAGE_SIZE = 24;
/** "Load more" grows the page this far (the RPC refuses offsets past 1000). */
export const DISCOVERY_MAX_PAGES = 10;
export const EXPERIENCE_STEPS = [1, 3, 5, 10] as const;
export const DISCOVERY_SORTS = ["recommended", "relevance", "rating", "availability", "experience", "followers", "newest"] as const;
export type DiscoverySort = (typeof DISCOVERY_SORTS)[number];
/** The minimum-rating steps the filter offers (published reviews; the database ignores anything outside 1..5). */
export const RATING_STEPS = [3, 3.5, 4, 4.5] as const;
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
  /** Any active service of one of these kinds (20261111110000). */
  serviceKinds: ServiceKind[];
  /** Speaks any of these (language codes, coach_languages). */
  languages: string[];
  /** Published reviews averaging at least this (one of RATING_STEPS). */
  minRating: number | null;
  /** A free public booking slot within the next 14 days. */
  available: boolean;
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
  experience: null, verified: false, priceMin: null, priceMax: null, accepting: true, serviceKinds: [], languages: [],
  minRating: null, available: false, sort: "recommended", page: 1, browse: false,
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
const LANGUAGE = /^[a-z]{2,3}$/;
/** Repeated or comma-separated values of one key, each kept only when `ok`, deduplicated, capped. */
function many(params: Params, key: string, ok: (v: string) => boolean, max: number): string[] {
  const values = all(params, key).flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()).filter(ok);
  return [...new Set(values)].slice(0, max);
}
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
    serviceKinds: many(params, "service", (v) => (SERVICE_KINDS as readonly string[]).includes(v), SERVICE_KINDS.length) as ServiceKind[],
    languages: many(params, "language", (v) => LANGUAGE.test(v), 10),
    minRating: (RATING_STEPS as readonly number[]).includes(Number(one(params, "rating"))) ? Number(one(params, "rating")) : null,
    available: one(params, "available") === "true",
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
  for (const k of query.serviceKinds) p.append("service", k);
  for (const l of query.languages) p.append("language", l);
  if (query.minRating !== null) p.set("rating", String(query.minRating));
  if (query.available) p.set("available", "true");
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
  return query.q.trim() !== "" || filterCount(query) > 0;
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
    // 20261111110000, same rule: only when set
    ...(query.serviceKinds.length ? { p_service_kinds: query.serviceKinds } : {}),
    ...(query.languages.length ? { p_languages: query.languages } : {}),
    ...(query.minRating !== null ? { p_min_rating: query.minRating } : {}),
    ...(query.available ? { p_available: true } : {}),
  };
}

/**
 * Which filter a change set, by the closed names marketplace_track() takes
 * (filter_applied, 20261111120000) — never its value. Null when nothing a
 * reader would call a filter changed (the text, the page).
 */
export type FilterName =
  | "city" | "country" | "gym" | "format" | "specialization" | "service_kind" | "language" | "experience" | "rating"
  | "availability" | "price" | "verified" | "accepting" | "sort";
export function changedFilter(before: DiscoveryQuery, after: DiscoveryQuery): FilterName | null {
  const diff = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  if (diff(before.city, after.city)) return "city";
  if (diff(before.country, after.country)) return "country";
  if (diff(before.gym, after.gym)) return "gym";
  if (before.online !== after.online || before.inPerson !== after.inPerson || before.hybrid !== after.hybrid) return "format";
  if (diff(before.specializations, after.specializations)) return "specialization";
  if (diff(before.serviceKinds, after.serviceKinds)) return "service_kind";
  if (diff(before.languages, after.languages)) return "language";
  if (before.experience !== after.experience) return "experience";
  if (before.minRating !== after.minRating) return "rating";
  if (before.available !== after.available) return "availability";
  if (before.priceMin !== after.priceMin || before.priceMax !== after.priceMax) return "price";
  if (before.verified !== after.verified) return "verified";
  if (before.accepting !== after.accepting) return "accepting";
  if (before.sort !== after.sort) return "sort";
  return null;
}

/** How many filters narrow the list (the text and the sort are not filters). Five or more reads as "too restrictive". */
export function filterCount(query: DiscoveryQuery): number {
  return [
    query.country, query.city, query.gym, query.online || null, query.inPerson || null, query.hybrid || null,
    query.experience, query.verified || null, query.priceMin ?? query.priceMax, query.accepting ? null : true,
    query.minRating, query.available || null,
  ].filter((v) => v !== null && v !== undefined).length
    + query.specializations.length + query.serviceKinds.length + query.languages.length;
}
export const RESTRICTIVE_FILTERS = 5;

// ---------- facets and chips ----------

export type DiscoveryFacets = {
  /** Every active specialization; `coaches` = published coaches with it (20261111110000). */
  specializations: { slug: string; name_en: string; name_ro: string; coaches?: number }[];
  countries: { code: string; slug: string; name_en: string; name_ro: string; coaches: number }[];
  cities: { slug: string; name: string; name_en: string; country_code: string; coaches: number }[];
  /** Active gyms with a published coach (20261027100000); `city` is a city slug. */
  gyms: { id: string; name: string; city: string; coaches: number }[];
  /** Languages some published coach speaks (20261111110000). */
  languages: { code: string; name_en: string; name_ro: string; native_name: string; coaches: number }[];
  /** Service kinds some published coach offers. */
  service_kinds: { kind: ServiceKind; coaches: number }[];
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
  /** "{n}+ ★" */
  rating?: string;
  available?: string;
  /** Service kind → its label (the services' own names in messages). */
  serviceKinds?: Partial<Record<ServiceKind, string>>;
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
  for (const kind of query.serviceKinds) {
    chips.push({ key: `service:${kind}`, label: labels.serviceKinds?.[kind] ?? kind, remove: withChange(query, { serviceKinds: query.serviceKinds.filter((x) => x !== kind) }) });
  }
  for (const code of query.languages) {
    const l = facets.languages.find((x) => x.code === code);
    chips.push({ key: `lang:${code}`, label: l ? l.native_name : code, remove: withChange(query, { languages: query.languages.filter((x) => x !== code) }) });
  }
  if (query.minRating !== null) {
    chips.push({ key: "rating", label: fillN(labels.rating ?? "{n}+ ★", { n: query.minRating }), remove: withChange(query, { minRating: null }) });
  }
  if (query.available) chips.push({ key: "available", label: labels.available ?? "available", remove: withChange(query, { available: false }) });
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
  /** The caller's own shortlist (20261102100000); absent for anonymous callers. */
  is_saved?: boolean;
  /** The profile id (public already), for the Save button. Absent before 20261102100000. */
  id?: string;
  /** Published reviews (20261106100000): null when there are none. Absent before that migration. */
  rating?: { average: number | string; count: number } | null;
  /** A free public booking slot within 7 days (20261111110000). Absent before that migration. */
  available_soon?: boolean;
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
  /** From the database's derived review columns — never computed here, never made up. */
  rating: { average: number; count: number } | null;
  /**
   * What the card's Follow button needs — set only when the search ran for a
   * signed-in reader and the card is not their own. Null otherwise: an
   * anonymous reader gets a sign-in link, the coach themselves nothing.
   */
  follow: { userId: string; following: boolean; followsMe: boolean } | null;
  /**
   * The Save button's state: null when it cannot be shown as a toggle (an
   * anonymous reader — Save then leads to sign-in — or the coach's own card).
   */
  save: { profileId: string; saved: boolean } | null;
  profileId: string | null;
  isSelf: boolean;
  /** Bookable within the week — from the database, never a score. */
  availableSoon: boolean;
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
    rating: row.rating && row.rating.count > 0 ? { average: Number(row.rating.average), count: row.rating.count } : null,
    follow: row.user_id && !row.is_self
      ? { userId: row.user_id, following: row.is_following === true, followsMe: row.follows_me === true }
      : null,
    isSelf: row.is_self === true,
    save: row.id && row.user_id && !row.is_self ? { profileId: row.id, saved: row.is_saved === true } : null,
    profileId: row.id ?? null,
    availableSoon: row.available_soon === true,
  };
}

export type EmptyKind =
  | "none" | "no_coaches" | "no_match_filters" | "no_match_search" | "no_match_location" | "no_match_specialization"
  | "too_restrictive";

/**
 * Which empty state to show: nobody published at all; nothing for the typed
 * text (suggest other words); nothing in the chosen place or specialization
 * when that is the only thing narrowing (offer to drop just it); many filters
 * at once (say they are too many, offer Clear filters); else nothing for
 * these filters.
 */
export function emptyKind(total: number, query: DiscoveryQuery): EmptyKind {
  if (total > 0) return "none";
  if (!hasFilters(query)) return "no_coaches";
  if (filterCount(query) >= RESTRICTIVE_FILTERS) return "too_restrictive";
  const rest = (change: Partial<DiscoveryQuery>) => filterCount({ ...query, ...change }) === 0;
  if (!query.q && (query.city || query.country || query.gym) && rest({ city: null, country: null, gym: null })) return "no_match_location";
  if (!query.q && query.specializations.length > 0 && rest({ specializations: [] })) return "no_match_specialization";
  return filterCount(query) === 0 ? "no_match_search" : "no_match_filters";
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

// ---------- SEO landing pages (/coaches/<city | specialization | country>) ----------
//
// Slugs of cities, countries and specializations share one namespace with
// coach slugs (coach_slug_reserved(), 20261020100000), so /coaches/<slug> can
// be a landing page without a collision. These — and only these — are the
// designated indexable listings: an arbitrary filter combination stays
// noindex, so the directory cannot mint thousands of near-duplicate pages.

export type DiscoveryLanding = {
  kind: "city" | "specialization" | "country";
  slug: string;
  /** In the reader's language. */
  name: string;
  /** Published coaches there, from the facets — 0 makes the page noindex. */
  coaches: number;
  /** The listing the page shows: the one dimension, every other filter at its default. */
  query: DiscoveryQuery;
};

/** The landing page a slug names, or null when it is not a city, specialization or country that the directory knows. */
export function landingFor(slug: string, facets: DiscoveryFacets, locale: "en" | "ro"): DiscoveryLanding | null {
  const base = { ...EMPTY_QUERY, browse: true };
  const city = facets.cities.find((c) => c.slug === slug);
  if (city) {
    return { kind: "city", slug, name: locale === "ro" ? city.name : city.name_en, coaches: city.coaches, query: { ...base, city: slug } };
  }
  const spec = facets.specializations.find((s) => s.slug === slug);
  if (spec) {
    return {
      kind: "specialization", slug, name: locale === "ro" ? spec.name_ro : spec.name_en, coaches: spec.coaches ?? 0,
      query: { ...base, specializations: [slug] },
    };
  }
  const country = facets.countries.find((c) => c.slug === slug);
  if (country) {
    return { kind: "country", slug, name: locale === "ro" ? country.name_ro : country.name_en, coaches: country.coaches, query: { ...base, country: slug } };
  }
  return null;
}

/**
 * How many published coaches a landing page needs before search engines are
 * offered it: one or two cards is a thin page that competes with the coach's
 * own profile. Below it the page still works (noindex, follow) and stays out
 * of the sitemap.
 */
export const LANDING_MIN_COACHES = 3;

export function landingIndexable(landing: Pick<DiscoveryLanding, "coaches">): boolean {
  return landing.coaches >= LANDING_MIN_COACHES;
}

/**
 * The landing page a listing query is exactly (one city, one specialization
 * or one country, nothing else but the default sort and page), or null. Used
 * to link to the indexable address instead of the parameterised one.
 */
export function landingSlugOf(query: DiscoveryQuery): string | null {
  const only = (change: Partial<DiscoveryQuery>) =>
    !query.q && query.sort === "recommended" && query.page === 1 && filterCount({ ...query, ...change }) === 0;
  if (query.city && only({ city: null, country: null })) return query.city;
  if (query.specializations.length === 1 && only({ specializations: [] })) return query.specializations[0]!;
  if (query.country && only({ country: null })) return query.country;
  return null;
}

/** The address of a listing: its landing page when it is one, else /coaches?…. */
export function listingHref(query: DiscoveryQuery): string {
  const landing = landingSlugOf(query);
  return landing ? `/coaches/${landing}` : `/coaches${discoverySearch(query)}`;
}

/** Every indexable landing page (LANDING_MIN_COACHES or more), for the sitemap. */
export function landingSlugs(facets: DiscoveryFacets): string[] {
  const ok = (n: number | undefined) => landingIndexable({ coaches: n ?? 0 });
  return [
    ...facets.cities.filter((c) => ok(c.coaches)).map((c) => c.slug),
    ...facets.specializations.filter((s) => ok(s.coaches)).map((s) => s.slug),
    ...facets.countries.filter((c) => ok(c.coaches)).map((c) => c.slug),
  ];
}
