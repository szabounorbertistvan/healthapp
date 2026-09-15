import Link from "next/link";
import { notFound } from "next/navigation";
import { getFollowList, getSocialProfile } from "@/lib/social-data";
import { currentActorId } from "@/lib/actor";
import { Card } from "@/components/ui";
import { Avatar, FollowButton } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";

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
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/people/${id}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        <span className="max-w-[14rem] truncate">{profile.name}</span>
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold tabular-nums text-ink-faint">{count}</span>
      </div>

      <Card plain className="mt-5 overflow-hidden p-0 sm:mt-6">
        {page.items.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-faint">{list === "followers" ? s.noFollowers : s.noFollowing}</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {page.items.map((p) => (
              <li key={p.id} className="flex min-h-14 items-center gap-3 px-5 py-3">
                <Link href={`/people/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={p.name} url={p.avatar_url} size="h-10 w-10" />
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                    {p.username ? <span className="block truncate text-[12.5px] text-ink-faint">@{p.username}</span> : null}
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
          className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {s.loadMore}
        </Link>
      ) : null}
    </div>
  );
}
