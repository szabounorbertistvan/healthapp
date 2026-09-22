import Link from "next/link";
import { normalizeRoutineFilter, ROUTINE_PAGE_SIZE, type RoutineCard } from "@healthapp/shared";
import { getDiscoverRoutines, getMyRoutines, getSavedRoutines } from "@/lib/routine-data";
import { exerciseFacets } from "@/lib/exercise-library";
import { EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { RoutineCardView } from "@/components/routine-card";
import { RoutineFilters } from "@/components/routine-filters";
import { getI18n } from "@/lib/i18n/server";

type Tab = "mine" | "discover" | "saved";

/**
 * The routine library: what I have, what other people published, what I saved.
 *
 * The tab, the filters and the page number all live in the URL, so the shelf
 * is rendered on the server already filtered — no spinner, no flash of the
 * unfiltered list, and a filtered view can be linked to.
 *
 * This lives under (client) rather than beside the coach's /programs because
 * a route may only be defined once: /programs is the coach's desk, where a
 * program is always somebody's prescription. Coaches reach this shelf through
 * "My training" like any other client surface.
 */
export default async function RoutinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t } = await getI18n();
  const r = t.clientApp.routines;
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);

  const tab: Tab = one("tab") === "discover" ? "discover" : one("tab") === "saved" ? "saved" : "mine";
  const filter = normalizeRoutineFilter({
    q: one("q"), level: one("level"), goal: one("goal"),
    muscle: one("muscle"), equipment: one("equipment"), sort: one("sort"),
  });
  const page = Math.max(1, parseInt(one("page") ?? "1", 10) || 1);

  // Only the open tab is read. Discover is the one that pages.
  let cards: RoutineCard[] = [];
  let hasMore = false;
  if (tab === "mine") cards = await getMyRoutines();
  else if (tab === "saved") cards = await getSavedRoutines();
  else {
    const found = await getDiscoverRoutines(filter, page);
    cards = found.cards;
    hasMore = found.hasMore;
  }

  const facets = tab === "discover" ? exerciseFacets() : { muscles: [], equipment: [] };

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{r.title}</h1>
          <p className="mt-2 text-[13px] text-ink-faint">{r.subtitle}</p>
        </div>
        <Link
          href="/workout/build"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 font-display text-[13px] font-bold text-accent-fg hover:opacity-90"
        >
          <NavIcon d="M12 5v14M5 12h14" className="h-[17px] w-[17px]" />
          {r.newRoutine}
        </Link>
      </div>

      {/* Tabs are links, not state: the browser's back button then walks the
          tabs, which is what people expect of something that changes the page. */}
      <nav className="mt-5 flex gap-1.5 overflow-x-auto pb-1" aria-label={r.title}>
        {([["mine", r.mine], ["discover", r.discover], ["saved", r.saved]] as const).map(([key, label]) => (
          <Link
            key={key}
            href={key === "mine" ? "/routines" : `/routines?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={`inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold ${
              tab === key ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "discover" ? (
        <RoutineFilters filter={filter} muscles={facets.muscles} equipment={facets.equipment} />
      ) : null}

      {cards.length === 0 ? (
        <div className="mt-5">
          <EmptyState plain {...emptyFor(tab, filter.q || filter.level || filter.goal ? "filtered" : "none", r)} />
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] sm:gap-4">
          {cards.map((card) => (
            <RoutineCardView key={card.id} card={card} />
          ))}
        </div>
      )}

      {tab === "discover" && (page > 1 || hasMore) ? (
        <Pager page={page} hasMore={hasMore} params={params} previous={r.previous} next={r.next} />
      ) : null}
    </div>
  );
}

type Strings = Awaited<ReturnType<typeof getI18n>>["t"]["clientApp"]["routines"];

function emptyFor(tab: Tab, kind: "filtered" | "none", r: Strings): { title: string; hint: string } {
  if (tab === "discover" && kind === "filtered") return { title: r.noResults, hint: r.emptyDiscoverHint };
  if (tab === "discover") return { title: r.emptyDiscoverTitle, hint: r.emptyDiscoverHint };
  if (tab === "saved") return { title: r.emptySavedTitle, hint: r.emptySavedHint };
  return { title: r.emptyMineTitle, hint: r.emptyMineHint };
}

/**
 * Offset paging. Discover sorts by two different keys, so a keyset cursor
 * would need a different shape for each; the read asks for one row more than
 * a page to know whether "next" leads anywhere.
 */
function Pager({
  page, hasMore, params, previous, next,
}: {
  page: number;
  hasMore: boolean;
  params: Record<string, string | string[] | undefined>;
  previous: string;
  next: string;
}) {
  function href(target: number): string {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v) q.set(key, v);
    }
    q.set("tab", "discover");
    if (target <= 1) q.delete("page");
    else q.set("page", String(target));
    return `/routines?${q.toString()}`;
  }
  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
          <NavIcon d="m15 6-6 6 6 6" className="h-4 w-4" />
          {previous}
        </Link>
      ) : <span />}
      <span className="text-[12.5px] tabular-nums text-ink-faint">
        {(page - 1) * ROUTINE_PAGE_SIZE + 1}–{(page - 1) * ROUTINE_PAGE_SIZE + ROUTINE_PAGE_SIZE}
      </span>
      {hasMore ? (
        <Link href={href(page + 1)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink">
          {next}
          <NavIcon d="m9 6 6 6-6 6" className="h-4 w-4" />
        </Link>
      ) : <span />}
    </div>
  );
}
