"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  DISCOVERY_CURRENCY, DISCOVERY_SORTS, EXPERIENCE_STEPS, clearFilters, discoverySearch, filterChips, withChange,
  type DiscoveryFacets, type DiscoveryQuery, type DiscoverySort,
} from "@/lib/coach-discovery";
import { BUTTON, FIELD, HINT, LABEL, SMALL_BUTTON } from "@/lib/form-classes";
import { Chip, Switch } from "../ui";
import { NavIcon } from "../client-nav";

// Every control writes the search into the URL (lib/coach-discovery.ts) and
// the server renders the list — the same pattern as PeopleSearchBox: shareable,
// back-button friendly, and the page works as plain links without JavaScript.

const PATH = "/coaches";

/**
 * A filter, sort or chip is a step the reader may want to go back from, so it
 * pushes a history entry; the debounced search text replaces the current one
 * (one entry per search, not one per word). Every control here leads to the
 * listing, so turning the last filter off shows every coach (?all=1) rather
 * than swapping the page for the Discovery Home under the reader's hand.
 */
function useDiscoveryNav() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (next: DiscoveryQuery, mode: "push" | "replace" = "push") =>
    start(() => router[mode](`${PATH}${discoverySearch({ ...next, browse: true })}`, { scroll: false }));
  return { go, pending };
}

/**
 * The big search box. Debounced (250 ms, as PeopleSearchBox) — not a request
 * per key — and every filter in the URL rides along. Emptying it shows every
 * coach (?all=1, see useDiscoveryNav).
 */
export function CoachSearchBox({ query }: { query: DiscoveryQuery }) {
  const { t } = useI18n();
  const d = t.coachProfile.discovery;
  const { go, pending } = useDiscoveryNav();
  const [q, setQ] = useState(query.q);
  const first = useRef(true);
  const latest = useRef(query);
  latest.current = query;

  // a back / forward or a chip click changes the URL under us: follow it
  useEffect(() => { setQ(query.q); }, [query.q]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (q.trim() === latest.current.q) return;
    const timer = setTimeout(() => go(withChange(latest.current, { q: q.trim() }), "replace"), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <form
      role="search" aria-busy={pending} action={PATH} className="w-full"
      onSubmit={(e) => { e.preventDefault(); go(withChange(latest.current, { q: q.trim() })); }}
    >
      <label className="flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 shadow-sm focus-within:border-accent">
        <NavIcon
          d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3"
          className={`h-5 w-5 shrink-0 ${pending ? "animate-pulse text-accent" : "text-ink-faint"}`}
        />
        <span className="sr-only">{d.searchLabel}</span>
        <input
          type="search" name="q" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)}
          placeholder={d.searchPlaceholder} autoComplete="off" enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button
            type="button" aria-label={d.clearSearch} title={d.clearSearch}
            onClick={() => { setQ(""); go(withChange(latest.current, { q: "" })); }}
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-bg hover:text-ink"
          >
            <NavIcon d="M6 6l12 12M18 6L6 18" className="h-4 w-4" />
          </button>
        ) : null}
      </label>
    </form>
  );
}

/**
 * The hero's location control: the cities that have a published coach
 * (coach_discovery_facets), the same filter as the sidebar's city select.
 */
export function CitySelect({ query, facets }: { query: DiscoveryQuery; facets: DiscoveryFacets }) {
  const { t, locale } = useI18n();
  const h = t.coachProfile.discovery.home;
  const { go, pending } = useDiscoveryNav();
  const id = useId();
  return (
    <div className="relative sm:w-[220px]">
      <label htmlFor={id} className="sr-only">{h.cityLabel}</label>
      <NavIcon
        d="M12 21s-7-6.1-7-11.5a7 7 0 1 1 14 0C19 14.9 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"
        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint"
      />
      <select
        id={id} aria-busy={pending} value={query.city ?? ""}
        onChange={(e) => go(withChange(query, { city: e.target.value || null }))}
        className="h-14 w-full appearance-none rounded-2xl border border-line bg-surface pl-11 pr-4 text-[15px] text-ink shadow-sm outline-none focus:border-accent"
      >
        <option value="">{h.anyCity}</option>
        {facets.cities.map((c) => (
          <option key={c.slug} value={c.slug}>{locale === "ro" ? c.name : c.name_en} ({c.coaches})</option>
        ))}
      </select>
    </div>
  );
}

/** The example searches under the box, shown only before anything is searched. */
export function ExampleQueries({ query }: { query: DiscoveryQuery }) {
  const { t } = useI18n();
  const d = t.coachProfile.discovery;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-faint">
      <span>{d.examples}</span>
      {d.exampleQueries.map((ex) => (
        <Link key={ex} href={`${PATH}${discoverySearch(withChange(query, { q: ex }))}`}
          className="rounded-full bg-surface px-3 py-1 font-semibold text-ink-soft hover:text-ink">
          {ex}
        </Link>
      ))}
    </p>
  );
}

/** The filters themselves — one body for the desktop sidebar and the phone sheet. */
function FilterFields({ query, facets }: { query: DiscoveryQuery; facets: DiscoveryFacets }) {
  const { t, locale } = useI18n();
  const d = t.coachProfile.discovery;
  const w = t.coachProfile.wizard;
  const { go, pending } = useDiscoveryNav();
  const ids = useId();
  const name = (x: { name_en: string; name_ro: string }) => (locale === "ro" ? x.name_ro : x.name_en);
  const cities = facets.cities.filter((c) => {
    const country = facets.countries.find((x) => x.slug === query.country);
    return !country || c.country_code === country.code;
  });
  // the gyms of the chosen city, or of the cities left by the chosen country
  const gyms = facets.gyms.filter((g) => (query.city ? g.city === query.city : cities.some((c) => c.slug === g.city)));

  // prices: typed freely, applied after a pause
  const [min, setMin] = useState(query.priceMin?.toString() ?? "");
  const [max, setMax] = useState(query.priceMax?.toString() ?? "");
  useEffect(() => { setMin(query.priceMin?.toString() ?? ""); setMax(query.priceMax?.toString() ?? ""); }, [query.priceMin, query.priceMax]);
  const latest = useRef(query);
  latest.current = query;
  useEffect(() => {
    const toN = (v: string) => (/^\d{1,7}$/.test(v.trim()) && Number(v) > 0 ? Number(v) : null);
    const nMin = toN(min), nMax = toN(max);
    if (nMin === latest.current.priceMin && nMax === latest.current.priceMax) return;
    const timer = setTimeout(() => go(withChange(latest.current, { priceMin: nMin, priceMax: nMax }), "replace"), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max]);

  return (
    <div className="grid gap-6" aria-busy={pending}>
      <fieldset>
        <legend className={LABEL}>{d.location}</legend>
        <label className="sr-only" htmlFor={`${ids}-country`}>{d.country}</label>
        <select id={`${ids}-country`} className={FIELD} value={query.country ?? ""}
          onChange={(e) => go(withChange(query, { country: e.target.value || null, city: null, gym: null }))}>
          <option value="">{d.anyCountry}</option>
          {facets.countries.map((c) => <option key={c.slug} value={c.slug}>{name(c)} ({c.coaches})</option>)}
        </select>
        <label className="sr-only" htmlFor={`${ids}-city`}>{d.city}</label>
        <select id={`${ids}-city`} className={FIELD} value={query.city ?? ""}
          onChange={(e) => go(withChange(query, { city: e.target.value || null, gym: null }))}>
          <option value="">{d.anyCity}</option>
          {cities.map((c) => <option key={c.slug} value={c.slug}>{locale === "ro" ? c.name : c.name_en} ({c.coaches})</option>)}
        </select>
        {gyms.length > 0 || query.gym ? (
          <>
            <label className="sr-only" htmlFor={`${ids}-gym`}>{d.gym}</label>
            <select id={`${ids}-gym`} className={FIELD} value={query.gym ?? ""}
              onChange={(e) => go(withChange(query, { gym: e.target.value || null }))}>
              <option value="">{d.anyGym}</option>
              {gyms.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.coaches})</option>)}
            </select>
          </>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className={LABEL}>{d.format}</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip on={query.online} onToggle={() => go(withChange(query, { online: !query.online }))}>{d.online}</Chip>
          <Chip on={query.inPerson} onToggle={() => go(withChange(query, { inPerson: !query.inPerson }))}>{d.inPerson}</Chip>
          <Chip on={query.hybrid} onToggle={() => go(withChange(query, { hybrid: !query.hybrid }))}>{d.hybrid}</Chip>
        </div>
        <p className={HINT}>{d.hybridHint}</p>
      </fieldset>

      <fieldset>
        <legend className={LABEL}>{d.specializations}</legend>
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="discovery-specializations">
          {facets.specializations.map((s) => {
            const on = query.specializations.includes(s.slug);
            return (
              <Chip key={s.slug} on={on} onToggle={() => go(withChange(query, {
                specializations: on ? query.specializations.filter((x) => x !== s.slug) : [...query.specializations, s.slug],
              }))}>
                {name(s)}
              </Chip>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className={LABEL}>{d.experience}</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip on={query.experience === null} onToggle={() => go(withChange(query, { experience: null }))}>{d.anyExperience}</Chip>
          {EXPERIENCE_STEPS.map((n) => (
            <Chip key={n} on={query.experience === n} onToggle={() => go(withChange(query, { experience: query.experience === n ? null : n }))}>
              {fill(d.yearsPlus, { n })}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={LABEL}>{fill(d.price, { currency: DISCOVERY_CURRENCY })}</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>
            <span className="sr-only">{d.priceMin}</span>
            <input className={FIELD} inputMode="numeric" placeholder={d.priceMin} aria-label={d.priceMin}
              value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className={LABEL}>
            <span className="sr-only">{d.priceMax}</span>
            <input className={FIELD} inputMode="numeric" placeholder={d.priceMax} aria-label={d.priceMax}
              value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
        <p className={HINT}>{d.priceHint}</p>
      </fieldset>

      <Switch
        checked={query.verified} onChange={(v) => go(withChange(query, { verified: v }))}
        label={d.verifiedOnly} hint={d.verifiedHint} onLabel={w.on} offLabel={w.off}
      />

      <Switch
        checked={query.accepting} onChange={(v) => go(withChange(query, { accepting: v }))}
        label={d.acceptingOnly} hint={d.acceptingHint} onLabel={w.on} offLabel={w.off}
      />
    </div>
  );
}

/** Desktop: the filters as a sidebar. */
export function FiltersSidebar({ query, facets }: { query: DiscoveryQuery; facets: DiscoveryFacets }) {
  const { t } = useI18n();
  return (
    <aside aria-label={t.coachProfile.discovery.filters} className="hidden lg:block">
      {/* one surface panel, like the phone sheet: the chips and fields are bg-bg and need it */}
      <div className="sticky top-6 rounded-3xl bg-surface p-5">
        <FilterFields query={query} facets={facets} />
      </div>
    </aside>
  );
}

/** Phones and tablets: [Filters (n)] opens a bottom sheet; [Sort] sits beside it. */
export function MobileFilterBar({ query, facets, active, total }: {
  query: DiscoveryQuery; facets: DiscoveryFacets; active: number; total: number;
}) {
  const { t } = useI18n();
  const d = t.coachProfile.discovery;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2 lg:hidden">
      <button type="button" className={`${SMALL_BUTTON} h-11 bg-surface px-4`} onClick={() => setOpen(true)}>
        {d.filters}{active > 0 ? ` (${active})` : ""}
      </button>
      <SortSelect query={query} />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
            <Dialog.Popup className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface outline-none">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
                <Dialog.Title className="font-display text-lg font-bold">{d.filters}{active > 0 ? ` (${active})` : ""}</Dialog.Title>
                <Link href={`${PATH}${discoverySearch(clearFilters(query))}`} scroll={false}
                  className="text-[13px] font-semibold text-accent-ink">{d.clearAll}</Link>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <FilterFields query={query} facets={facets} />
              </div>
              <div className="border-t border-line px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                {/* every tap above already ran the search: this only closes, with the live count */}
                <Dialog.Close className={`${BUTTON} w-full`} data-testid="filters-show">
                  {total === 0 ? d.showNone : total === 1 ? d.showCountOne : fill(d.showCount, { n: total })}
                </Dialog.Close>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function SortSelect({ query }: { query: DiscoveryQuery }) {
  const { t } = useI18n();
  const d = t.coachProfile.discovery;
  const { go } = useDiscoveryNav();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">{d.sort}</label>
      <select
        id={id} value={query.sort} title={query.sort === "recommended" ? d.recommendedHint : undefined}
        onChange={(e) => go(withChange(query, { sort: e.target.value as DiscoverySort }))}
        className="h-11 rounded-2xl border border-line bg-surface px-3.5 text-[13.5px] font-semibold text-ink outline-none ring-accent/50 focus:ring-2"
      >
        {DISCOVERY_SORTS.map((s) => <option key={s} value={s}>{d.sorts[s]}</option>)}
      </select>
    </div>
  );
}

/** The active filters as removable chips, and Clear all. Links, so they work without JavaScript. */
export function ActiveFilters({ query, facets }: { query: DiscoveryQuery; facets: DiscoveryFacets }) {
  const { t, locale } = useI18n();
  const d = t.coachProfile.discovery;
  const chips = filterChips(query, facets, locale, {
    online: d.online, inPerson: d.inPerson, hybrid: d.hybrid, verified: d.verifiedChip, experience: d.yearsPlus, priceFrom: d.priceFrom,
    priceTo: d.priceTo, priceRange: d.priceRange, includeFull: d.includeFull,
  });
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={d.filters} data-testid="active-filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link href={`${PATH}${discoverySearch(chip.remove)}`} scroll={false}
            aria-label={fill(d.removeFilter, { name: chip.label })}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-[12.5px] font-semibold text-accent-ink hover:bg-accent hover:text-accent-fg">
            {chip.label} <span aria-hidden>×</span>
          </Link>
        </li>
      ))}
      <li>
        <Link href={`${PATH}${discoverySearch(clearFilters(query))}`} scroll={false}
          className="ml-1 text-[12.5px] font-semibold text-ink-faint hover:text-ink hover:underline">
          {d.clearAll}
        </Link>
      </li>
    </ul>
  );
}
