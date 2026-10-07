import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, SITE_URL } from "@/lib/brand";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getProfile } from "@/lib/data";
import { getDiscoveryFacets, searchCoaches } from "@/lib/coach-profile-data";
import {
  EMPTY_QUERY, clearFilters, discoverySearch, emptyKind, filterChips, hasFilters, hasMore, isDiscoveryHome, matchViewerCity,
  parseDiscoveryQuery, toCoachCard, withChange, type DiscoveryFacets, type DiscoveryQuery,
} from "@/lib/coach-discovery";
import { CoachCard } from "@/components/coach-discovery/coach-card";
import { DiscoveryHome, type NearState } from "@/components/coach-discovery/home";
import {
  ActiveFilters, CoachSearchBox, ExampleQueries, FiltersSidebar, MobileFilterBar, SortSelect,
} from "@/components/coach-discovery/controls";
import { MarketplaceTracker } from "@/components/marketplace-tracker";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The listing has one canonical address. A filtered or searched URL is a
 * working, shareable page, but not indexed (yet): the indexable combinations
 * (/coaches/cluj, …) are a later, deliberate step.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [{ t, locale }, params] = await Promise.all([getI18n(), searchParams]);
  const d = t.coachProfile.discovery;
  const query = parseDiscoveryQuery(params);
  const title = `${d.metaTitle} | ${APP_NAME}`;
  const url = `${SITE_URL}/coaches`;
  return {
    title,
    description: d.metaDescription,
    alternates: { canonical: url },
    robots: isDiscoveryHome(query) ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "website", url, title, description: d.metaDescription, siteName: APP_NAME, locale: locale === "ro" ? "ro_RO" : "en_GB" },
    twitter: { card: "summary", title, description: d.metaDescription },
  };
}

/** On the home: the first recommended coaches, and the coaches of the reader's city. */
const HOME_RECOMMENDED = 8;
const HOME_NEAR = 4;

/**
 * /coaches — Coach Discovery. Public (middleware lets /coaches through), and
 * server-rendered from the URL. With nothing asked for it is the Discovery
 * Home; any search, filter or "See all" (?all=1) is the listing, where
 * search_coaches() returns the page of cards, the total and the order in one
 * call and coach_discovery_facets() the filter options. Never an RPC per card.
 */
export default async function CoachesPage({ searchParams }: Props) {
  const [{ t, locale }, params, profile] = await Promise.all([getI18n(), searchParams, getProfile()]);
  const signedIn = Boolean(profile);
  const query = parseDiscoveryQuery(params);
  // a directory view, with the city / specialization a listing is about (20261110120000)
  const tracker = (
    <MarketplaceTracker view="directory_view" city={query.city}
      specialization={query.specializations.length === 1 ? query.specializations[0] : null} />
  );
  if (isDiscoveryHome(query)) return <>{tracker}<Home query={query} profile={profile} locale={locale} /></>;

  const d = t.coachProfile.discovery;
  const [result, facets] = await Promise.all([searchCoaches(query), getDiscoveryFacets()]);
  const cards = result.items.map((row) => toCoachCard(row, locale));
  const empty = emptyKind(result.total, query);
  const activeCount = filterChips(query, facets, locale, {
    online: "", inPerson: "", hybrid: "", verified: "", experience: "", priceFrom: "", priceTo: "", priceRange: "", includeFull: "",
  }).length;

  return (
    <div>
      {tracker}
      {/* ---------- search: compact on a phone, so the results start on the first screen ---------- */}
      <section className="mx-auto max-w-3xl pb-5 pt-2 text-center sm:pb-10 sm:pt-8">
        <Link href="/coaches" className="text-[13px] font-semibold text-ink-faint hover:text-ink">← {d.backToDiscover}</Link>
        <h1 className="mt-2 font-display text-[24px] font-extrabold leading-tight tracking-tight sm:text-[44px]">{d.title}</h1>
        <p className="mx-auto mt-3 hidden max-w-[52ch] text-[15px] text-ink-soft sm:block sm:text-[17px]">{d.subtitle}</p>
        <div className="mt-4 text-left sm:mt-8">
          <CoachSearchBox query={query} />
          {!hasFilters(query) ? <ExampleQueries query={query} /> : null}
        </div>
      </section>

      {/* ---------- filters + results ---------- */}
      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
        <FiltersSidebar query={query} facets={facets} />

        <section aria-labelledby="coach-results" aria-live="polite">
          <MobileFilterBar query={query} facets={facets} active={activeCount} total={result.total} />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 lg:mt-0">
            <h2 id="coach-results" className="text-[14px] font-semibold text-ink-soft" data-testid="coach-results-count">
              {query.q ? `${fill(d.resultsFor, { q: query.q })} · ` : !hasFilters(query) ? `${d.explore} · ` : ""}
              {result.total === 1 ? d.countOne : fill(d.count, { n: result.total })}
            </h2>
            <div className="hidden lg:block"><SortSelect query={query} /></div>
          </div>
          <div className="mt-3"><ActiveFilters query={query} facets={facets} /></div>

          {empty === "none" ? (
            <>
              <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-4" data-testid="coach-results">
                {cards.map((card) => <li key={card.href}><CoachCard card={card} signedIn={signedIn} /></li>)}
              </ul>
              {hasMore(result.total, query) ? (
                <div className="mt-8 flex justify-center">
                  {/* a real link: crawlers and no-JS readers can follow it too */}
                  <Link href={`/coaches${discoverySearch(withChange(query, { page: query.page + 1 }))}`} scroll={false}
                    className="inline-flex h-11 items-center rounded-2xl bg-surface px-6 font-display text-sm font-bold hover:bg-accent-soft">
                    {d.loadMore}
                  </Link>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-6 rounded-3xl bg-surface px-6 py-12 text-center" data-testid="coach-results-empty" data-kind={empty}>
              <p className="font-display text-lg font-bold">{empty === "no_coaches" ? d.noCoaches : d.noMatch}</p>
              <p className="mx-auto mt-2 max-w-[48ch] text-[14px] text-ink-soft">
                {empty === "no_coaches" ? d.noCoachesHint : empty === "no_match_search" ? fill(d.noSearchHint, { q: query.q }) : d.noMatchHint}
              </p>
              {empty !== "no_coaches" ? (
                <Link
                  href={`/coaches${discoverySearch(empty === "no_match_search" ? clearFilters(query, false) : clearFilters(query))}`}
                  scroll={false}
                  className="mt-5 inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
                >
                  {empty === "no_match_search" ? d.explore : d.clearFilters}
                </Link>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The Discovery Home's data, in two waves at most: the recommended row and
 * the facets side by side, then — only when the reader's profile city is one
 * that has coaches — that city's row. An empty recommended row (no coach is
 * taking clients) falls back to every published coach before it says
 * "no coaches".
 */
async function Home({ query, profile, locale }: {
  query: DiscoveryQuery;
  profile: Awaited<ReturnType<typeof getProfile>>;
  locale: "en" | "ro";
}) {
  const [first, facets] = await Promise.all([searchCoaches(EMPTY_QUERY, HOME_RECOMMENDED), getDiscoveryFacets()]);
  let recommended = { result: first, seeAll: { ...EMPTY_QUERY, browse: true } as DiscoveryQuery };
  if (first.total === 0) {
    const all = { ...EMPTY_QUERY, accepting: false };
    recommended = { result: await searchCoaches(all, HOME_RECOMMENDED), seeAll: all };
  }
  const near = await nearState(profile, facets, locale);

  const role = profile?.role ?? null;
  const coachCtaHref = !profile ? `/login?${new URLSearchParams({ next: "/account" })}`
    : role === "client" ? "/account" : "/settings/coach-profile";

  return (
    <DiscoveryHome
      query={query}
      facets={facets}
      recommended={{ cards: recommended.result.items.map((row) => toCoachCard(row, locale)), total: recommended.result.total, seeAll: recommended.seeAll }}
      near={near}
      signedIn={Boolean(profile)}
      coachCtaHref={coachCtaHref}
    />
  );
}

async function nearState(
  profile: Awaited<ReturnType<typeof getProfile>>, facets: DiscoveryFacets, locale: "en" | "ro",
): Promise<NearState> {
  if (!profile) return { kind: "anonymous" };
  const typed = profile.city?.trim();
  // the profile form lives on /account for a client and on /settings for a coach
  if (!typed) return { kind: "no_city", editHref: profile.role === "client" ? "/account" : "/settings" };
  const city = matchViewerCity(typed, facets.cities);
  if (!city) return { kind: "no_coaches_in_city", city: typed };
  // everyone published there (taking clients first): a full coach nearby is still a coach nearby
  const seeAll: DiscoveryQuery = { ...EMPTY_QUERY, city: city.slug, accepting: false };
  const result = await searchCoaches(seeAll, HOME_NEAR);
  if (result.total === 0) return { kind: "no_coaches_in_city", city: locale === "ro" ? city.name : city.name_en };
  return {
    kind: "matched",
    city: { slug: city.slug, name: locale === "ro" ? city.name : city.name_en },
    seeAll,
    cards: result.items.map((row) => toCoachCard(row, locale)),
    total: result.total,
  };
}
