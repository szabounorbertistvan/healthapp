import Link from "next/link";
import { searchPeople } from "@/lib/social-data";
import { Card } from "@/components/ui";
import { Avatar, FollowButton } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";
const SEARCH = "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3";

/** Find people by name — a plain GET form, results under it. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { t } = await getI18n();
  const { q = "" } = await searchParams;
  const s = t.common.social;
  const people = q.trim().length >= 2 ? await searchPeople(q) : [];
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/feed"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {s.feed}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{s.findPeople}</h1>

      <form className="mt-5 flex gap-2 sm:mt-6">
        <label className="flex h-[42px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-surface px-3.5">
          <NavIcon d={SEARCH} className="h-[17px] w-[17px] shrink-0 text-ink-faint" />
          <input
            name="q"
            defaultValue={q}
            placeholder={s.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </label>
        <button
          type="submit"
          className="flex h-[42px] shrink-0 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
        >
          {s.findPeople}
        </button>
      </form>

      <div className="mt-4">
        {q.trim().length < 2 ? (
          <p className="text-[13px] text-ink-faint">{s.searchHint}</p>
        ) : people.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{s.noResults}</p>
        ) : (
          <Card plain className="overflow-hidden p-0">
            <ul className="divide-y divide-line/60">
              {people.map((p) => (
                <li key={p.id} className="flex min-h-14 items-center gap-3 px-5 py-3">
                  <Link href={`/people/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={p.name} url={p.avatar_url} size="h-10 w-10" />
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                      {p.username ? <span className="block truncate text-[12.5px] text-ink-faint">@{p.username}</span> : null}
                    </span>
                  </Link>
                  <FollowButton userId={p.id} following={p.is_following} compact />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
