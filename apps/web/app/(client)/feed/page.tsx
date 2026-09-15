import Link from "next/link";
import { getFeed } from "@/lib/social-data";
import { Card } from "@/components/ui";
import { Composer, PostCard } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const PEOPLE = "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 20v-1a4 4 0 0 0-3-3.9M16.5 4.1a4 4 0 0 1 0 7.8";

/**
 * The home feed: own posts and the people the client follows, newest first,
 * one page at a time (?before= is the cursor — plain links, so it works
 * without JavaScript and with back/forward).
 */
export default async function FeedPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { t } = await getI18n();
  const { before } = await searchParams;
  const page = await getFeed({ before: before ?? null });
  const s = t.common.social;
  // Only the first page carries the composer; after that the feed is the whole column.
  const composing = !before;

  return (
    <div className="mx-auto max-w-[1600px]">
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

      {/* Posts fill as many columns as fit; the composer sits beside them once
          the window is wide enough, and above them on a phone. */}
      <div
        className={
          composing
            ? "mt-5 grid items-start gap-4 sm:mt-6 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-6"
            : "mt-5 sm:mt-6"
        }
      >
        {composing ? (
          <div className="2xl:order-2 2xl:sticky 2xl:top-7">
            <Composer />
          </div>
        ) : null}

        <div className="2xl:order-1">
          {page.items.length === 0 && !before ? (
            <Card plain className="py-10 text-center">
              <p className="font-display text-lg font-bold tracking-tight">{s.emptyTitle}</p>
              <p className="mt-1.5 text-[13px] text-ink-soft">{s.emptyHint}</p>
              <Link
                href="/people"
                className="mt-4 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
              >
                {s.findPeople}
              </Link>
            </Card>
          ) : (
            <div className="grid items-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] sm:gap-4">
              {page.items.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          )}

          {page.next_cursor ? (
            <Link
              href={`/feed?before=${encodeURIComponent(page.next_cursor)}`}
              className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
            >
              {s.loadMore}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
