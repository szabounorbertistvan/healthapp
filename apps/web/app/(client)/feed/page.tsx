import Link from "next/link";
import { isFeedScope, type FeedScope } from "@healthapp/shared";
import { getFeed } from "@/lib/social-data";
import { displayName, getProfile } from "@/lib/data";
import { Composer, PostCard } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { StoriesBar } from "@/components/stories";
import { getStoryTray } from "@/lib/stories-data";
import { getI18n } from "@/lib/i18n/server";
import { SOCIAL } from "@/lib/social-ui";

const SHARE = "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M7 8l5-5 5 5";
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

  // One wave: the stories row only matters on the first page.
  const [page, profile, tray] = await Promise.all([
    getFeed({ before, scope }),
    getProfile(),
    before ? Promise.resolve([]) : getStoryTray(),
  ]);
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
    <div className={SOCIAL.column}>
      {/* Compact on purpose: on a phone the shell's sticky header is already
          above this, carrying the bell, language and theme. */}
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[22px] font-extrabold tracking-tight sm:text-2xl">{s.feed}</h1>
        <Link
          href="/people"
          className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-4"
        >
          <NavIcon d={PEOPLE} className="h-[18px] w-[18px]" />
          <span className="sr-only sm:not-sr-only">{s.findPeople}</span>
        </Link>
      </header>

      {composing ? (
        <div className="mt-3">
          <StoriesBar me={me} tray={tray} />
        </div>
      ) : null}

      {/* Links rather than state: the scope is in the URL, so back walks the
          tabs and a filtered feed can be shared. Three equal segments, so the
          row never scrolls sideways, even at 320px. */}
      <nav
        className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-line bg-surface p-1"
        aria-label={s.feed}
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "following" ? "/feed" : `/feed?scope=${tab.key}`}
            aria-current={scope === tab.key ? "page" : undefined}
            className={`flex h-10 min-w-0 items-center justify-center truncate rounded-full px-2 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              scope === tab.key ? "bg-accent text-accent-fg" : "text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {composing ? (
        <div className="mt-3">
          <Composer me={me} />
        </div>
      ) : null}

      {page.items.length === 0 && !before ? (
        <EmptyFeed scope={scope} s={s} />
      ) : (
        // Edge to edge on a phone, cards in a column from sm.
        <div className={`mt-4 space-y-3 sm:space-y-5 ${SOCIAL.bleed}`}>
          {page.items.map((p) => (
            <PostCard key={p.id} post={p} bleed />
          ))}
        </div>
      )}

      {page.next_cursor ? (
        <Link
          href={`/feed?scope=${scope}&before=${encodeURIComponent(page.next_cursor)}`}
          className="mt-5 flex h-11 items-center justify-center rounded-2xl border border-line bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
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
    <div className="mt-4 rounded-2xl border border-line bg-surface px-6 py-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent-ink">
        <NavIcon d={scope === "mine" ? SHARE : PEOPLE} className="h-6 w-6" />
      </span>
      <p className="mt-4 font-display text-lg font-bold tracking-tight">{copy.title}</p>
      <p className="mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-ink-soft">{copy.hint}</p>
      <Link
        href={copy.href}
        className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {copy.cta}
      </Link>
    </div>
  );
}
