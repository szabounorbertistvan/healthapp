import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import {
  EMPTY_QUERY, QUICK_SPECIALIZATIONS, discoverySearch, type CoachCardModel, type DiscoveryFacets, type DiscoveryQuery,
} from "@/lib/coach-discovery";
import { CoachCard } from "./coach-card";
import { CitySelect, CoachSearchBox } from "./controls";

/**
 * "Coaches near you" in one of four honest states. Location is only ever the
 * city typed in the reader's profile (users.city), matched to a city that has
 * a coach (matchViewerCity) — never the device's position.
 */
export type NearState =
  | { kind: "matched"; city: { slug: string; name: string }; seeAll: DiscoveryQuery; cards: CoachCardModel[]; total: number }
  | { kind: "no_coaches_in_city"; city: string }
  | { kind: "no_city"; editHref: string }
  | { kind: "anonymous" };

export type DiscoveryHomeProps = {
  query: DiscoveryQuery;
  facets: DiscoveryFacets;
  /** The "recommended" order of search_coaches(), first page; `seeAll` is the listing it continues in. */
  recommended: { cards: CoachCardModel[]; total: number; seeAll: DiscoveryQuery };
  near: NearState;
  signedIn: boolean;
  /** Where "Create your coach profile" goes for this reader. */
  coachCtaHref: string;
};

const href = (q: Partial<DiscoveryQuery>) => `/coaches${discoverySearch({ ...EMPTY_QUERY, ...q })}`;

/**
 * /coaches with nothing searched: the Discovery Home. Every number and card
 * on it comes from search_coaches() / coach_discovery_facets(); every chip,
 * tile and "See all" is a plain link into the listing (the URL is the state,
 * lib/coach-discovery.ts), so the page works without JavaScript and each
 * step is shareable.
 */
export async function DiscoveryHome({ query, facets, recommended, near, signedIn, coachCtaHref }: DiscoveryHomeProps) {
  const { t, locale } = await getI18n();
  const d = t.coachProfile.discovery;
  const h = d.home;
  const specName = (x: { name_en: string; name_ro: string }) => (locale === "ro" ? x.name_ro : x.name_en);
  const noCoaches = recommended.total === 0;

  const quick: { key: string; label: string; href: string }[] = [
    ...(near.kind === "matched" ? [{ key: "near", label: h.nearMe, href: `/coaches${discoverySearch(near.seeAll)}` }] : []),
    { key: "online", label: d.online, href: href({ online: true }) },
    { key: "in_person", label: d.inPerson, href: href({ inPerson: true }) },
    ...QUICK_SPECIALIZATIONS.flatMap((slug) => {
      const s = facets.specializations.find((x) => x.slug === slug);
      return s ? [{ key: slug, label: specName(s), href: href({ specializations: [slug] }) }] : [];
    }),
  ];

  return (
    <div className="grid gap-12 sm:gap-16">
      {/* ---------- hero: what this is, and the search ---------- */}
      <section className="relative pt-4 sm:pt-10">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-56 w-[min(640px,100%)] -translate-x-1/2 rounded-full bg-accent-soft opacity-70 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <h1 className="font-display text-[30px] font-extrabold leading-[1.08] tracking-tight sm:text-[46px]">{d.title}</h1>
          <p className="mx-auto mt-3 max-w-[56ch] text-[15px] text-ink-soft sm:text-[17px]">{d.subtitle}</p>
          <div className="mt-6 flex flex-col gap-2 text-left sm:mt-8 sm:flex-row">
            <div className="min-w-0 flex-1"><CoachSearchBox query={query} /></div>
            {facets.cities.length > 0 ? <CitySelect query={query} facets={facets} /> : null}
          </div>
        </div>

        {/* quick discovery intents — each one a real filter of search_coaches(); pointless with nobody to filter */}
        {noCoaches ? null : <nav aria-label={h.quickFilters} className="relative mt-5">
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0">
            {quick.map((q) => (
              <li key={q.key} className="shrink-0">
                <Link href={q.href}
                  className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-4 text-[13.5px] font-semibold text-ink-soft transition hover:border-accent hover:text-ink">
                  {q.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>}
      </section>

      {noCoaches ? (
        <div className="rounded-3xl bg-surface px-6 py-12 text-center" data-testid="coach-results-empty" data-kind="no_coaches">
          <p className="font-display text-lg font-bold">{d.noCoaches}</p>
          <p className="mx-auto mt-2 max-w-[48ch] text-[14px] text-ink-soft">{d.noCoachesHint}</p>
        </div>
      ) : (
        <>
          {/* ---------- recommended ---------- */}
          <section aria-labelledby="home-recommended" data-testid="home-recommended">
            <SectionHead
              id="home-recommended" title={h.recommended} hint={h.recommendedHint}
              link={{ href: `/coaches${discoverySearch(recommended.seeAll)}`, label: recommended.total > recommended.cards.length ? fill(h.seeAllCount, { n: recommended.total }) : h.seeAll }}
            />
            <CoachRow cards={recommended.cards} signedIn={signedIn} />
          </section>

          {/* ---------- near you ---------- */}
          <section aria-labelledby="home-near" data-testid="home-near" data-kind={near.kind}>
            {near.kind === "matched" ? (
              <>
                <SectionHead
                  id="home-near" title={h.near} hint={fill(h.nearBasedOn, { city: near.city.name })}
                  link={{ href: `/coaches${discoverySearch(near.seeAll)}`, label: fill(h.nearSeeAll, { city: near.city.name }) }}
                />
                <CoachRow cards={near.cards} signedIn={signedIn} />
              </>
            ) : near.kind === "no_coaches_in_city" ? (
              <>
                <SectionHead id="home-near" title={h.near} hint={fill(h.nearBasedOn, { city: near.city })} />
                <Notice title={fill(h.nearNone, { city: near.city })} body={h.nearNoneHint}
                  action={{ href: href({ online: true }), label: h.browseOnline }} />
                <CityChips facets={facets} locale={locale} labels={h} />
              </>
            ) : (
              <>
                <SectionHead id="home-near" title={near.kind === "no_city" ? h.near : h.byCity}
                  hint={near.kind === "no_city" ? undefined : h.byCityHint} />
                {near.kind === "no_city" ? (
                  <Notice title={h.nearNoCity} body={h.nearNoCityHint} action={{ href: near.editHref, label: h.addCity }} />
                ) : null}
                {facets.cities.length > 0 ? (
                  <CityChips facets={facets} locale={locale} labels={h} />
                ) : (
                  <p className="mt-4 text-[14px] text-ink-soft">{h.noCities}</p>
                )}
              </>
            )}
          </section>

          {/* ---------- by specialty ---------- */}
          {facets.specializations.length > 0 ? (
            <section aria-labelledby="home-specialties" data-testid="home-specialties">
              <SectionHead id="home-specialties" title={h.specialties} hint={h.specialtiesHint} />
              <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {facets.specializations.map((s, i) => (
                  <li key={s.slug}>
                    <Link href={href({ specializations: [s.slug] })}
                      className="group flex h-full min-h-[76px] items-end justify-between gap-2 rounded-2xl bg-surface p-4 transition hover:bg-accent-soft">
                      <span className="font-display text-[15px] font-bold leading-tight tracking-tight sm:text-[16px]">{specName(s)}</span>
                      <span aria-hidden className="text-[12px] font-bold text-ink-faint group-hover:text-accent-ink">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {/* ---------- the promise: find a coach, then the whole journey ---------- */}
      <section aria-labelledby="home-how" className="rounded-[28px] bg-surface p-6 sm:p-10">
        <h2 id="home-how" className="max-w-[24ch] font-display text-[22px] font-extrabold leading-tight tracking-tight sm:text-[28px]">{h.howTitle}</h2>
        <ol className="mt-6 grid gap-5 sm:grid-cols-3 sm:gap-6">
          {h.steps.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent font-display text-[14px] font-extrabold text-accent-fg">{i + 1}</span>
              <div>
                <p className="font-display text-[15.5px] font-bold">{step.title}</p>
                <p className="mt-1 text-[13.5px] text-ink-soft">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-col items-start gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] text-ink-soft"><span className="font-semibold text-ink">{h.forCoaches}</span> {h.forCoachesBody}</p>
          <Link href={coachCtaHref}
            className="inline-flex h-11 shrink-0 items-center rounded-2xl bg-bg px-5 font-display text-sm font-bold hover:bg-accent-soft">
            {h.forCoachesCta} →
          </Link>
        </div>
      </section>
    </div>
  );
}

function SectionHead({ id, title, hint, link }: { id: string; title: string; hint?: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-[22px] font-extrabold tracking-tight sm:text-[26px]">{title}</h2>
        {hint ? <p className="mt-1 max-w-[62ch] text-[13.5px] text-ink-faint">{hint}</p> : null}
      </div>
      {link ? (
        <Link href={link.href} className="shrink-0 text-[14px] font-semibold text-accent-ink hover:underline">{link.label} →</Link>
      ) : null}
    </div>
  );
}

/** Phones: one swipeable row, a card and a bit of the next. Tablet up: a grid. */
function CoachRow({ cards, signedIn }: { cards: CoachCardModel[]; signedIn: boolean }) {
  return (
    <ul className="-mx-4 mt-5 flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
      {cards.map((card) => (
        <li key={card.href} className="w-[84%] max-w-[340px] shrink-0 snap-start sm:w-auto sm:max-w-none">
          <CoachCard card={card} signedIn={signedIn} />
        </li>
      ))}
    </ul>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action: { href: string; label: string } }) {
  return (
    <div className="mt-5 flex flex-col items-start gap-3 rounded-3xl bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div>
        <p className="font-display text-[16px] font-bold">{title}</p>
        <p className="mt-1 text-[13.5px] text-ink-soft">{body}</p>
      </div>
      <Link href={action.href}
        className="inline-flex h-10 shrink-0 items-center rounded-full bg-accent px-4 text-[13.5px] font-semibold text-accent-fg hover:opacity-90">
        {action.label}
      </Link>
    </div>
  );
}

function CityChips({ facets, locale, labels }: {
  facets: DiscoveryFacets;
  locale: "en" | "ro";
  labels: { cityCoaches: string; cityCoachesOne: string };
}) {
  if (facets.cities.length === 0) return null;
  const cities = [...facets.cities].sort((a, b) => b.coaches - a.coaches || a.name.localeCompare(b.name)).slice(0, 12);
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {cities.map((c) => (
        <li key={c.slug}>
          <Link href={href({ city: c.slug })}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-[13.5px] font-semibold hover:bg-accent-soft">
            {locale === "ro" ? c.name : c.name_en}
            <span className="text-[12px] font-semibold text-ink-faint">
              {c.coaches === 1 ? labels.cityCoachesOne : fill(labels.cityCoaches, { n: c.coaches })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
