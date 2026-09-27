import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getFollowList, getSocialProfile } from "@/lib/social-data";
import { currentActorId } from "@/lib/actor";
import { PeopleList } from "@/components/people-list";
import { ListSearchBox } from "@/components/social-v2";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";
import { SOCIAL } from "@/lib/social-ui";
import type { PersonRow } from "@/lib/types";

const BACK = "m15 6-6 6 6 6";

/**
 * /people/[id]/followers and /people/[id]/following — who follows a person
 * and whom they follow, with the two lists as tabs, a search over the whole
 * list, and one page at a time (?before= is the cursor, ?q= the search, both
 * plain links, so back and forward work).
 *
 * The counts in the tabs are social_profile's server-side counts, never the
 * number of rows loaded; they and the list apply the same rule, so an account
 * that is suspended or being deleted is in neither. Each row carries the
 * viewer's own two edges to that person, from the same query.
 */
export default async function FollowListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; list: string }>;
  searchParams: Promise<{ before?: string; q?: string }>;
}) {
  const { t } = await getI18n();
  const [{ id, list }, { before, q }] = await Promise.all([params, searchParams]);
  if (list !== "followers" && list !== "following") notFound();
  const query = q?.trim() ?? "";
  // One wave: the header's counts and the page of rows are independent reads.
  const [profile, page, viewer] = await Promise.all([
    getSocialProfile(id),
    getFollowList(id, list, before ?? null, query || null),
    currentActorId(),
  ]);
  if (!profile) notFound();
  const s = t.common.social;

  const base = `/people/${id}/${list}`;
  const tabs = [
    { key: "followers", label: s.followers, count: profile.followers },
    { key: "following", label: s.followingCount, count: profile.following },
  ] as const;

  const empty = query
    ? s.noResults
    : list === "followers"
      ? (profile.me ? s.noFollowersMine : s.noFollowers)
      : (profile.me ? s.noFollowingMine : s.noFollowing);

  // The second line of a row: how this person relates to the viewer, when
  // they relate at all; otherwise their handle, when it adds anything.
  const detail = (p: PersonRow) =>
    p.is_following && p.follows_me ? s.relationMutual
    : p.follows_me ? s.relationFollowsYou
    : p.username && p.username !== p.name ? `@${p.username}` : "";

  const next = new URLSearchParams();
  if (query) next.set("q", query);
  if (page.next_cursor) next.set("before", page.next_cursor);

  return (
    <div className={SOCIAL.column}>
      <Link
        href={`/people/${id}`}
        className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        <span className="truncate">{profile.name}</span>
      </Link>

      <nav className="mt-4 grid grid-cols-2 border-b border-line" aria-label={profile.name}>
        {tabs.map((tab) => {
          const active = tab.key === list;
          return (
            <Link
              key={tab.key}
              href={`/people/${id}/${tab.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex h-12 items-center justify-center gap-1.5 border-b-2 text-[14px] font-semibold transition-colors ${
                active ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink-soft"
              }`}
            >
              <span className="tabular-nums">{tab.count}</span>
              <span className="truncate">{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4">
        {/* useSearchParams needs a Suspense boundary to prerender. */}
        <Suspense fallback={<div className="h-11 rounded-2xl border border-line bg-surface" />}>
          <ListSearchBox key={list} basePath={base} placeholder={s.searchList} />
        </Suspense>
      </div>

      <div className="mt-3">
        {page.items.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-5 py-10 text-center text-[13.5px] text-ink-soft">{empty}</p>
        ) : (
          <PeopleList people={page.items} viewerId={viewer} detail={detail} />
        )}
      </div>

      {page.next_cursor ? (
        <Link
          href={`${base}?${next}`}
          className="mt-4 flex h-11 items-center justify-center rounded-2xl border border-line bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {s.loadMore}
        </Link>
      ) : null}
    </div>
  );
}
