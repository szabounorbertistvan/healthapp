import Link from "next/link";
import { getFeed } from "@/lib/social-data";
import { Card, PageTitle } from "@/components/ui";
import { Composer, PostCard } from "@/components/social";
import { getI18n } from "@/lib/i18n/server";

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

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle title={s.feed}>
        <Link href="/people" className="text-xs font-semibold text-accent-ink hover:underline">
          {s.findPeople}
        </Link>
      </PageTitle>
      {!before ? <Composer /> : null}
      {page.items.length === 0 && !before ? (
        <Card className="py-10 text-center">
          <p className="font-semibold">{s.emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-soft">{s.emptyHint}</p>
          <Link href="/people" className="mt-4 inline-block rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg">
            {s.findPeople}
          </Link>
        </Card>
      ) : (
        page.items.map((p) => <PostCard key={p.id} post={p} />)
      )}
      {page.next_cursor ? (
        <Link
          href={`/feed?before=${encodeURIComponent(page.next_cursor)}`}
          className="block rounded-lg border border-line px-4 py-3 text-center text-sm font-semibold text-ink-soft hover:border-accent"
        >
          {s.loadMore}
        </Link>
      ) : null}
    </div>
  );
}
