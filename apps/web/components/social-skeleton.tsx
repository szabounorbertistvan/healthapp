import { SOCIAL } from "@/lib/social-ui";
import { PeopleListSkeleton } from "./people-list";

/**
 * Placeholder shapes for the social screens while their reads are in flight —
 * the layout arrives first, so nothing jumps when the rows land. Pure markup:
 * no data, no client JavaScript.
 */
function Bar({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded-full bg-surface ${className}`} />;
}

/** A list of people or notifications: avatar, two lines, a pill. */
export function ListSkeleton({ rows = 6, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true">
      {title ? <Bar className="h-8 w-48" /> : null}
      <Bar className="mt-5 h-[42px] w-full rounded-2xl" />
      <ul className="mt-4 space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3 rounded-2xl bg-surface/60 px-4 py-3.5">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-bg" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block h-3.5 w-2/5 animate-pulse rounded-full bg-bg" />
              <span className="block h-3 w-3/5 animate-pulse rounded-full bg-bg" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A profile, in the shape of the page: avatar beside the name and the three
 * counts, the button row, two lines of bio, the tabs, then a post.
 */
export function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[600px]" aria-busy="true">
      <Bar className="h-10 w-24" />
      <div className="mt-5 flex items-center gap-4 sm:gap-7">
        <span className="h-20 w-20 shrink-0 animate-pulse rounded-full bg-surface sm:h-28 sm:w-28" />
        <span className="min-w-0 flex-1 space-y-2.5">
          <span className="block h-6 w-2/5 animate-pulse rounded-full bg-surface" />
          <span className="block h-3 w-1/4 animate-pulse rounded-full bg-surface" />
          <span className="flex gap-5 pt-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block h-9 w-14 animate-pulse rounded-lg bg-surface" />
            ))}
          </span>
        </span>
      </div>
      <Bar className="mt-3.5 h-10 w-[136px]" />
      <Bar className="mt-3 h-3 w-4/5" />
      <Bar className="mt-2 h-3 w-3/5" />
      <div className="mt-5 grid grid-cols-3 gap-2 border-b border-line pb-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="mx-auto block h-3.5 w-16 animate-pulse rounded-full bg-surface" />
        ))}
      </div>
      <div className="mt-4">
        <PostSkeleton />
      </div>
    </div>
  );
}

/** /people: the title, the search row, the suggestions heading and rows. */
export function PeopleSkeleton() {
  return (
    <div className={SOCIAL.column} aria-busy="true">
      <Bar className="h-10 w-24" />
      <Bar className="mt-4 h-7 w-28" />
      <Bar className="mt-4 h-11 w-full rounded-2xl" />
      <Bar className="mt-4 h-3 w-32" />
      <div className="mt-2.5">
        <PeopleListSkeleton rows={6} />
      </div>
    </div>
  );
}

/** A followers / following list: the back pill, the two tabs, search, rows. */
export function FollowListSkeleton() {
  return (
    <div className={SOCIAL.column} aria-busy="true">
      <Bar className="h-10 w-32" />
      <div className="mt-4 grid grid-cols-2 border-b border-line pb-4 pt-3">
        {[0, 1].map((i) => (
          <span key={i} className="mx-auto block h-3.5 w-24 animate-pulse rounded-full bg-surface" />
        ))}
      </div>
      <Bar className="mt-4 h-11 w-full rounded-2xl" />
      <div className="mt-3">
        <PeopleListSkeleton rows={8} />
      </div>
    </div>
  );
}

// ---------- the feed ----------
// Same boxes, same sizes as StoriesBar and PostCard (lib/social-ui.ts), so the
// content lands where its placeholder was.

/** The stories strip: your circle and a few more, labels under them. */
export function StoriesSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={`${SOCIAL.bleed} overflow-hidden`} aria-hidden>
      <div className="flex gap-3.5 px-4 py-1 sm:px-0.5">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
            <span className={`block animate-pulse rounded-full bg-surface p-[2.5px] ${SOCIAL.avatar.story} box-content`} />
            <span className="block h-2.5 w-12 animate-pulse rounded-full bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One post: header, a 4:3 media frame, the action row, two lines of caption. */
export function PostSkeleton({ bleed = false }: { bleed?: boolean }) {
  return (
    <div
      className={`bg-surface pb-4 ${bleed ? "sm:rounded-2xl sm:border sm:border-line" : "rounded-2xl border border-line"}`}
      aria-hidden
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className={`shrink-0 animate-pulse rounded-full bg-bg ${SOCIAL.avatar.post}`} />
        <span className="flex-1 space-y-1.5">
          <span className="block h-3 w-28 animate-pulse rounded-full bg-bg" />
          <span className="block h-2.5 w-16 animate-pulse rounded-full bg-bg" />
        </span>
      </div>
      <div className="aspect-[4/3] animate-pulse bg-bg" />
      <div className="flex gap-4 px-4 pt-3.5">
        <span className="h-6 w-6 animate-pulse rounded-full bg-bg" />
        <span className="h-6 w-6 animate-pulse rounded-full bg-bg" />
      </div>
      <div className="space-y-2 px-4 pt-3.5">
        <span className="block h-3 w-40 animate-pulse rounded-full bg-bg" />
        <span className="block h-3 w-4/5 animate-pulse rounded-full bg-bg" />
        {/* the comment preview's first line */}
        <span className="block h-3 w-3/5 animate-pulse rounded-full bg-bg" />
        <span className="block h-2.5 w-14 animate-pulse rounded-full bg-bg" />
      </div>
    </div>
  );
}

/** The whole feed column while social_feed() is in flight. */
export function FeedSkeleton() {
  return (
    <div className={SOCIAL.column} aria-busy="true">
      <div className="flex h-11 items-center justify-between">
        <Bar className="h-7 w-24" />
        <span className="h-11 w-11 animate-pulse rounded-full bg-surface" />
      </div>
      <div className="mt-2 flex gap-1.5">
        {[64, 56, 92].map((w) => (
          <span key={w} style={{ width: w }} className="block h-10 animate-pulse rounded-full bg-surface" />
        ))}
      </div>
      <div className="mt-4">
        <StoriesSkeleton />
      </div>
      <div className={`mt-4 space-y-3 sm:space-y-5 ${SOCIAL.bleed}`}>
        <PostSkeleton bleed />
        <PostSkeleton bleed />
      </div>
    </div>
  );
}
