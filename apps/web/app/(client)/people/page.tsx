import Link from "next/link";
import { Suspense } from "react";
import { getSuggestedPeople, searchPeople } from "@/lib/social-data";
import { Card } from "@/components/ui";
import { Avatar, FollowButton } from "@/components/social";
import { PeopleSearchBox } from "@/components/social-v2";
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
  const [results, suggested] = await Promise.all([
    searching ? searchPeople(q, city || null, Number(page)) : Promise.resolve(null),
    searching ? Promise.resolve([] as PersonRow[]) : getSuggestedPeople(),
  ]);

  const pageHref = (n: number) => {
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (city.trim()) next.set("city", city.trim());
    if (n > 1) next.set("page", String(n));
    return `/people?${next}`;
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/feed"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {s.feed}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{s.discoverPeople}</h1>

      {/* useSearchParams needs a Suspense boundary to prerender. */}
      <Suspense fallback={<div className="mt-5 h-[42px] rounded-2xl bg-surface sm:mt-6" />}>
        <PeopleSearchBox placeholder={s.searchPlaceholder} cityPlaceholder={s.cityFilter} submitLabel={s.findPeople} />
      </Suspense>

      <div className="mt-4">
        {!results ? (
          suggested.length > 0 ? (
            <>
              <h2 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{s.suggested}</h2>
              <div className="mt-2.5">
                <PeopleList people={suggested} labels={{ mutuals: s.mutualsCount, followers: s.followersCount }} />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-ink-faint">{s.searchHint}</p>
          )
        ) : results.items.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{s.noResults}</p>
        ) : (
          <>
            <PeopleList people={results.items} labels={{ mutuals: s.mutualsCount, followers: s.followersCount }} />
            {results.hasMore || results.page > 1 ? (
              <nav className="mt-4 flex items-center justify-between gap-3">
                {results.page > 1 ? (
                  <Link
                    href={pageHref(results.page - 1)}
                    className="inline-flex h-10 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
                  >
                    ←
                  </Link>
                ) : <span />}
                {results.hasMore ? (
                  <Link
                    href={pageHref(results.page + 1)}
                    className="inline-flex h-10 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
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

/** One list shape for search results and suggestions alike. */
function PeopleList({ people, labels }: { people: PersonRow[]; labels: { mutuals: string; followers: string } }) {
  return (
    <Card plain className="overflow-hidden p-0">
      <ul className="divide-y divide-line/60">
        {people.map((p) => {
          // Why this person is here, in words: shared connections when there
          // are any, otherwise how many people follow them.
          const reason = p.mutuals
            ? fill(labels.mutuals, { count: p.mutuals })
            : p.followers
              ? fill(labels.followers, { count: p.followers })
              : "";
          const detail = [p.username ? `@${p.username}` : "", p.city ?? "", reason].filter(Boolean).join(" · ");
          return (
            <li key={p.id} className="flex min-h-14 items-center gap-3 px-5 py-3">
              <Link href={`/people/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={p.name} url={p.avatar_url} size="h-10 w-10" />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                  <span className="block truncate text-[12.5px] text-ink-faint">{detail}</span>
                </span>
              </Link>
              <FollowButton userId={p.id} following={p.is_following} compact />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
