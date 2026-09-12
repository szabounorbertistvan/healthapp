import Link from "next/link";
import { searchPeople } from "@/lib/social-data";
import { Card, PageTitle } from "@/components/ui";
import { Avatar, FollowButton } from "@/components/social";
import { getI18n } from "@/lib/i18n/server";

/** Find people by name — a plain GET form, results under it. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { t } = await getI18n();
  const { q = "" } = await searchParams;
  const s = t.common.social;
  const people = q.trim().length >= 2 ? await searchPeople(q) : [];
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/feed" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← {s.feed}
      </Link>
      <PageTitle title={s.findPeople} />
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder={s.searchPlaceholder}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
        />
        <button type="submit" className="min-h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg">
          {s.findPeople}
        </button>
      </form>
      {q.trim().length < 2 ? (
        <p className="text-sm text-ink-faint">{s.searchHint}</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-ink-faint">{s.noResults}</p>
      ) : (
        <Card className="p-0">
          <ul>
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <Link href={`/people/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={p.name} url={p.avatar_url} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.name}</span>
                    {p.username ? <span className="block truncate text-xs text-ink-faint">@{p.username}</span> : null}
                  </span>
                </Link>
                <FollowButton userId={p.id} following={p.is_following} compact />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
