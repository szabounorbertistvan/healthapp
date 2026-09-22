import Link from "next/link";
import { isFeedScope, type FeedScope } from "@healthapp/shared";
import { getFeed } from "@/lib/social-data";
import { displayName, getProfile } from "@/lib/data";
import { Card } from "@/components/ui";
import { Composer, PostCard } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const PEOPLE = "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16.5 4.1a4 4 0 0 1 0 7.8";

/**
 * The home feed, in three scopes: Following (own + followed, the original and
 * still the default), All (everything the visibility rules already allow) and
 * My activity.
 *
 * A scope widens who is LISTED, never what may be SEEN — the visibility
 * predicate is applied on top of all three inside social_feed(). Paging stays
 * a cursor on created_at, as plain links, so it works with back/forward and
 * without JavaScript.
 */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; scope?: string }>;
}) {
  const [{ t }, params] = await Promise.all([getI18n(), searchParams]);
  const scope: FeedScope = isFeedScope(params.scope) ? params.scope : "following";
  const before = params.before ?? null;

  const [page, profile] = await Promise.all([getFeed({ before, scope }), getProfile()]);
  const s = t.common.social;
  const me = profile ? { name: displayName(profile), avatar_url: profile.avatar_url } : undefined;
  // Only the first page carries the composer; after that the feed is the whole column.
  const composing = !before;

  const tabs: { key: FeedScope; label: string }[] = [
    { key: "following", label: s.feedFollowing },
    { key: "all", label: s.feedAll },
    { key: "mine", label: s.feedMine },
  ];

  return (
    <div className="mx-auto max-w-[680px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{s.feed}</h1>
        <Link
          href="/people"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink sm:h-10"
        >
          <NavIcon d={PEOPLE} className="h-[17px] w-[17px]" />
          {s.findPeople}
        </Link>
      </div>

      {/* Links rather than state: the scope is in the URL, so back walks the
          tabs and a filtered feed can be shared. */}
      <nav className="mt-4 flex gap-1.5 overflow-x-auto pb-1" aria-label={s.feed}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "following" ? "/feed" : `/feed?scope=${tab.key}`}
            aria-current={scope === tab.key ? "page" : undefined}
            className={`inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold ${
              scope === tab.key ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {composing ? (
        <div className="mt-4">
          <Composer me={me} />
        </div>
      ) : null}

      {page.items.length === 0 && !before ? (
        <EmptyFeed scope={scope} s={s} />
      ) : (
        <div className="mt-4 space-y-4">
          {page.items.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      {page.next_cursor ? (
        <Link
          href={`/feed?scope=${scope}&before=${encodeURIComponent(page.next_cursor)}`}
          className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {s.loadMore}
        </Link>
      ) : null}
    </div>
  );
}

type Social = Awaited<ReturnType<typeof getI18n>>["t"]["common"]["social"];

/**
 * Each scope is empty for its own reason, so each says its own thing and
 * offers the move that fixes it. Nothing is invented to fill the space.
 */
function EmptyFeed({ scope, s }: { scope: FeedScope; s: Social }) {
  const copy =
    scope === "mine"
      ? { title: s.emptyMineTitle, hint: s.emptyMineHint, href: "/workout", cta: s.shareWorkoutCta }
      : scope === "all"
        ? { title: s.emptyAllTitle, hint: s.emptyAllHint, href: "/people", cta: s.discoverPeople }
        : { title: s.emptyFollowingTitle, hint: s.emptyFollowingHint, href: "/people", cta: s.discoverPeople };

  return (
    <Card plain className="mt-4 py-10 text-center">
      <p className="font-display text-lg font-bold tracking-tight">{copy.title}</p>
      <p className="mt-1.5 text-[13px] text-ink-soft">{copy.hint}</p>
      <Link
        href={copy.href}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
      >
        {copy.cta}
      </Link>
    </Card>
  );
}
