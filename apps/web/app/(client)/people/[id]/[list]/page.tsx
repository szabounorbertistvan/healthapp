import Link from "next/link";
import { notFound } from "next/navigation";
import { getFollowList, getSocialProfile } from "@/lib/social-data";
import { currentActorId } from "@/lib/actor";
import { Card, PageTitle } from "@/components/ui";
import { Avatar, FollowButton } from "@/components/social";
import { getI18n } from "@/lib/i18n/server";

/**
 * /people/[id]/followers and /people/[id]/following — who follows a person
 * and whom they follow, one page at a time (?before= is the cursor, plain
 * links). Each row is the person's public profile, with the viewer's own
 * Follow / Following state on it; the viewer's own row shows no button.
 */
export default async function FollowListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; list: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { t } = await getI18n();
  const [{ id, list }, { before }] = await Promise.all([params, searchParams]);
  if (list !== "followers" && list !== "following") notFound();
  const [profile, page, viewer] = await Promise.all([getSocialProfile(id), getFollowList(id, list, before ?? null), currentActorId()]);
  if (!profile) notFound();
  const s = t.common.social;
  const title = list === "followers" ? s.followers : s.followingCount;
  const count = list === "followers" ? profile.followers : profile.following;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href={`/people/${id}`} className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← {profile.name}
      </Link>
      <PageTitle title={`${title} · ${count}`} />
      <Card className="p-2">
        {page.items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-faint">{list === "followers" ? s.noFollowers : s.noFollowing}</p>
        ) : (
          <ul className="divide-y divide-line">
            {page.items.map((p) => (
              <li key={p.id} className="flex min-h-14 items-center gap-3 px-2 py-2">
                <Link href={`/people/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={p.name} url={p.avatar_url} size="h-9 w-9" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    {p.username ? <span className="block truncate text-xs text-ink-faint">@{p.username}</span> : null}
                  </span>
                </Link>
                {p.id !== viewer ? <FollowButton userId={p.id} following={p.is_following} compact /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {page.next_cursor ? (
        <Link
          href={`/people/${id}/${list}?before=${encodeURIComponent(page.next_cursor)}`}
          className="block rounded-lg border border-line px-4 py-3 text-center text-sm font-semibold text-ink-soft hover:border-accent"
        >
          {s.loadMore}
        </Link>
      ) : null}
    </div>
  );
}
