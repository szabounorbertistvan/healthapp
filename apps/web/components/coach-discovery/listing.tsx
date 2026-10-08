import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import {
  clearFilters, emptyKind, filterCount, hasFilters, hasMore, listingHref, toCoachCard, withChange,
  type CoachSearchResult, type DiscoveryFacets, type DiscoveryQuery,
} from "@/lib/coach-discovery";
import { CoachCard } from "./coach-card";
import { ActiveFilters, FiltersSidebar, MobileFilterBar, SortSelect } from "./controls";

/**
 * The directory's results: filters (sidebar wide, a sheet on phones), the
 * count, the active filters, the cards, Load more, and an empty state that
 * says why there is nothing and offers the one change that helps. Shared by
 * /coaches and the landing pages (/coaches/<city | specialization |
 * country>) — one listing, whatever the address.
 *
 * The result is one search_coaches() page (≤ 24 × page, never the whole
 * directory): the server renders it, the controls only change the URL.
 */
export async function DiscoveryListing({ query, result, facets, signedIn, label }: {
  query: DiscoveryQuery;
  result: CoachSearchResult;
  facets: DiscoveryFacets;
  signedIn: boolean;
  /** What the count line says the results are of, when not a typed search ("Explore coaches"). */
  label?: string;
}) {
  const { t, locale } = await getI18n();
  const d = t.coachProfile.discovery;
  const cards = result.items.map((row) => toCoachCard(row, locale));
  const empty = emptyKind(result.total, query);
  const active = filterCount(query);

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <FiltersSidebar query={query} facets={facets} />

      <section aria-labelledby="coach-results" aria-live="polite">
        <MobileFilterBar query={query} facets={facets} active={active} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 lg:mt-0">
          <h2 id="coach-results" className="text-[14px] font-semibold text-ink-soft" data-testid="coach-results-count">
            {query.q ? `${fill(d.resultsFor, { q: query.q })} · ` : label ? `${label} · ` : !hasFilters(query) ? `${d.explore} · ` : ""}
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
                <Link href={listingHref(withChange(query, { page: query.page + 1 }))} scroll={false}
                  className="inline-flex h-11 items-center rounded-2xl bg-surface px-6 font-display text-sm font-bold hover:bg-accent-soft">
                  {d.loadMore}
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState kind={empty} query={query} facets={facets} locale={locale} active={active} />
        )}
      </section>
    </div>
  );
}

async function EmptyState({ kind, query, facets, locale, active }: {
  kind: Exclude<ReturnType<typeof emptyKind>, "none">; query: DiscoveryQuery; facets: DiscoveryFacets; locale: "en" | "ro"; active: number;
}) {
  const { t } = await getI18n();
  const d = t.coachProfile.discovery;
  const place = (() => {
    const city = facets.cities.find((c) => c.slug === query.city);
    if (city) return locale === "ro" ? city.name : city.name_en;
    const country = facets.countries.find((c) => c.slug === query.country);
    if (country) return locale === "ro" ? country.name_ro : country.name_en;
    return query.city ?? query.country ?? "";
  })();
  const spec = facets.specializations.find((s) => s.slug === query.specializations[0]);
  const specName = spec ? (locale === "ro" ? spec.name_ro : spec.name_en) : query.specializations[0] ?? "";
  const anywhere = withChange(query, { city: null, country: null, gym: null });

  const copy: { title: string; body: string; actions: { href: string; label: string; primary?: boolean }[] } = (() => {
    switch (kind) {
      case "no_coaches":
        return { title: d.noCoaches, body: d.noCoachesHint, actions: [] };
      case "no_match_search":
        return { title: d.noMatch, body: fill(d.noSearchHint, { q: query.q }), actions: [{ href: listingHref(clearFilters(query, false)), label: d.explore, primary: true }] };
      case "no_match_location":
        return {
          title: d.noMatchLocation, body: fill(d.noMatchLocationHint, { place }),
          actions: [
            { href: listingHref({ ...anywhere, online: true }), label: d.onlineInstead, primary: true },
            { href: listingHref({ ...anywhere, browse: true }), label: d.anywhere },
          ],
        };
      case "no_match_specialization":
        return {
          title: fill(d.noMatchSpecialization, { name: specName }), body: d.noMatchSpecializationHint,
          actions: [{ href: listingHref({ ...withChange(query, { specializations: [] }), browse: true }), label: d.allSpecializations, primary: true }],
        };
      case "too_restrictive":
        return { title: d.tooRestrictive, body: fill(d.tooRestrictiveHint, { n: active }), actions: [{ href: listingHref(clearFilters(query)), label: d.clearFilters, primary: true }] };
      case "no_match_filters":
        return { title: d.noMatch, body: d.noMatchHint, actions: [{ href: listingHref(clearFilters(query)), label: d.clearFilters, primary: true }] };
    }
  })();

  return (
    <div className="mt-6 rounded-3xl bg-surface px-6 py-12 text-center" data-testid="coach-results-empty" data-kind={kind}>
      <p className="font-display text-lg font-bold">{copy.title}</p>
      <p className="mx-auto mt-2 max-w-[48ch] text-[14px] text-ink-soft">{copy.body}</p>
      {copy.actions.length ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {copy.actions.map((a) => (
            <Link key={a.href} href={a.href} scroll={false}
              className={a.primary
                ? "inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
                : "inline-flex h-11 items-center rounded-2xl bg-bg px-5 font-display text-sm font-bold hover:bg-accent-soft"}>
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
