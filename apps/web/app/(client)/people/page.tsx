import Link from "next/link";
import { Suspense } from "react";
import { getSuggestedPeople, searchPeople } from "@/lib/social-data";
import { PeopleList } from "@/components/people-list";
import { PeopleSearchBox } from "@/components/social-v2";
import { currentActorId } from "@/lib/actor";
import { SOCIAL } from "@/lib/social-ui";
import { NavIcon } from "@/components/client-nav";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { PersonRow } from "@/lib/types";

const BACK = "m15 6-6 6 6 6";

/**
 * Discover people: search by name, handle or city — results follow the typing
 * through the URL, so the list stays server-rendered — paged, and, when
 * nothing is being searched for, suggestions.
 *
 * The suggestions are counted, not modelled: people followed by the people you
 * follow first, then the most-followed people so a new account is not shown
 * an empty page (social_suggested_people). Both are counts over follow edges,
 * which are public; nothing about anyone's training, food or body is used.
 * Search returns name, handle, avatar and city — what the profile header
 * already shows — and leaves out anyone pending deletion or suspended.
 */
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city?: string; page?: string }>;
}) {
  const { t } = await getI18n();
  const { q = "", city = "", page = "1" } = await searchParams;
  const s = t.common.social;
  const searching = q.trim().length >= 2 || city.trim().length >= 2;
  const [results, suggested, viewer] = await Promise.all([
    searching ? searchPeople(q, city || null, Number(page)) : Promise.resolve(null),
    searching ? Promise.resolve([] as PersonRow[]) : getSuggestedPeople(),
    currentActorId(),
  ]);
  // Why this person is here, in words: shared connections when there are any,
  // otherwise how many people follow them; with the handle and city in front.
  const detail = (p: PersonRow) => {
    const reason = p.mutuals
      ? fill(s.mutualsCount, { count: p.mutuals })
      : p.followers
        ? p.followers === 1 ? s.followersCountOne : fill(s.followersCount, { count: p.followers })
        : "";
    return [p.username && p.username !== p.name ? `@${p.username}` : "", p.city ?? "", reason].filter(Boolean).join(" · ");
  };

  const pageHref = (n: number) => {
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (city.trim()) next.set("city", city.trim());
    if (n > 1) next.set("page", String(n));
    return `/people?${next}`;
  };

  return (
    <div className={SOCIAL.column}>
      <Link
        href="/feed"
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {s.feed}
      </Link>
      <h1 className="mt-4 font-display text-[22px] font-extrabold tracking-tight sm:text-2xl">{s.people}</h1>

      {/* useSearchParams needs a Suspense boundary to prerender. */}
      <Suspense fallback={<div className="mt-4 h-11 rounded-2xl border border-line bg-surface" />}>
        <PeopleSearchBox placeholder={s.searchPlaceholder} cityPlaceholder={s.cityFilter} submitLabel={s.findPeople} />
      </Suspense>

      <div className="mt-4">
        {!results ? (
          suggested.length > 0 ? (
            <>
              <h2 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{s.suggested}</h2>
              <div className="mt-2.5">
                <PeopleList people={suggested} viewerId={viewer} detail={detail} />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-ink-faint">{s.searchHint}</p>
          )
        ) : results.items.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-5 py-10 text-center text-[13.5px] text-ink-soft">{s.noResults}</p>
        ) : (
          <>
            <PeopleList people={results.items} viewerId={viewer} detail={detail} />
            {results.hasMore || results.page > 1 ? (
              <nav className="mt-4 flex items-center justify-between gap-3">
                {results.page > 1 ? (
                  <Link
                    href={pageHref(results.page - 1)}
                    className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
                  >
                    ←
                  </Link>
                ) : <span />}
                {results.hasMore ? (
                  <Link
                    href={pageHref(results.page + 1)}
                    className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
                  >
                    {s.peopleMore}
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
