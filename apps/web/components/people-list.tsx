import Link from "next/link";
import { Avatar, FollowButton } from "./social";
import type { PersonRow } from "@/lib/types";

/**
 * One list shape for every list of people — search results, suggestions,
 * followers, following. A row is a link (avatar and name, one target) and,
 * beside it, not inside it, the follow button, so tapping the button never
 * navigates. `detail` is the second line: why this person is here, or how
 * they relate to the viewer. The viewer's own row carries no button.
 *
 * Server markup; only the button is a client component.
 */
export function PeopleList({
  people,
  viewerId,
  detail,
}: {
  people: PersonRow[];
  viewerId: string | null;
  detail: (person: PersonRow) => string;
}) {
  return (
    <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-surface">
      {people.map((p) => {
        const second = detail(p);
        return (
          <li key={p.id} className="flex min-h-[68px] items-center gap-3 py-2.5 pl-3 pr-3 sm:pl-4">
            <Link
              href={`/people/${p.id}`}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Avatar name={p.name} url={p.avatar_url} size="h-11 w-11" />
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold leading-tight">{p.name}</span>
                {second ? <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">{second}</span> : null}
              </span>
            </Link>
            {p.id !== viewerId ? (
              <FollowButton userId={p.id} following={p.is_following} followsMe={p.follows_me ?? false} compact />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The same rows as placeholders, for loading states. */
export function PeopleListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line/60 overflow-hidden rounded-2xl border border-line bg-surface" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex min-h-[68px] items-center gap-3 py-2.5 pl-3 pr-3 sm:pl-4">
          <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-bg" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3.5 w-2/5 animate-pulse rounded-full bg-bg" />
            <span className="block h-3 w-1/4 animate-pulse rounded-full bg-bg" />
          </span>
          <span className="h-9 w-[104px] shrink-0 animate-pulse rounded-full bg-bg" />
        </li>
      ))}
    </ul>
  );
}
