import Link from "next/link";
import { getSavedPosts } from "@/lib/social-data";
import { PostCard } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";
import { SOCIAL } from "@/lib/social-ui";

const BOOKMARK = "M6 3h12v18l-6-4.5L6 21z";

/**
 * /saved — the signed-in person's saved posts, newest save first, one page
 * at a time (?before= is the save-time cursor, plain links).
 *
 * There is no user in the URL and none in the RPC: social_saved_posts() is
 * always the caller's own list, so there is no way to ask for anyone else's.
 * A saved post its author has since deleted or hidden simply is not here.
 * Unsaving a card takes it away at once (PostCard removeOnUnsave) and brings
 * it back if the request fails.
 */
export default async function SavedPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const [{ t }, { before }] = await Promise.all([getI18n(), searchParams]);
  const page = await getSavedPosts(before ?? null);
  const s = t.common.social;

  return (
    <div className={SOCIAL.column}>
      <header>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight sm:text-2xl">{s.savedTitle}</h1>
        <p className="mt-1 text-[13px] text-ink-faint">{s.savedHint}</p>
      </header>

      {page.items.length === 0 && !before ? (
        <div className="mt-4 rounded-2xl border border-line bg-surface px-6 py-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <NavIcon d={BOOKMARK} className="h-6 w-6" />
          </span>
          <p className="mt-4 font-display text-lg font-bold tracking-tight">{s.savedEmptyTitle}</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-ink-soft">{s.savedEmptyHint}</p>
          <Link
            href="/feed"
            className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
          >
            {s.feed}
          </Link>
        </div>
      ) : (
        <div className={`mt-4 space-y-3 sm:space-y-5 ${SOCIAL.bleed}`}>
          {page.items.map((p) => (
            <PostCard key={p.id} post={p} bleed removeOnUnsave />
          ))}
        </div>
      )}

      {page.next_cursor ? (
        <Link
          href={`/saved?before=${encodeURIComponent(page.next_cursor)}`}
          className="mt-5 flex h-11 items-center justify-center rounded-2xl border border-line bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {s.loadMore}
        </Link>
      ) : null}
    </div>
  );
}
