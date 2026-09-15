import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeed, getSocialProfile } from "@/lib/social-data";
import { getUserStreak } from "@/lib/streak-data";
import { fill } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { Avatar, FollowButton, PostCard } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";
const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";

/**
 * A person's public profile: name, follow counts, three aggregate numbers,
 * the streak as two numbers (current, longest — never the days),
 * and the posts the viewer is allowed to see. Nothing private — no weight,
 * no nutrition, no sets.
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const [profile, posts, streak] = await Promise.all([getSocialProfile(id), getFeed({ author: id }), getUserStreak(id)]);
  if (!profile) notFound();
  const s = t.common.social;
  const st = t.common.streaks;
  // The two follow counts open the lists; the three activity counts are plain numbers.
  const stats: [string, number, string | null][] = [
    [s.followers, profile.followers, `/people/${profile.id}/followers`],
    [s.followingCount, profile.following, `/people/${profile.id}/following`],
    [s.workouts, profile.workouts, null],
    [s.prs, profile.prs, null],
    [s.challenges, profile.challenges, null],
  ];
  const stat = (label: string, value: number) => (
    <>
      <dd className="font-display text-xl font-extrabold tabular-nums leading-none">{value}</dd>
      <dt className="mt-1 truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
    </>
  );
  return (
    // A profile is one document: a readable column.
    <div className="mx-auto max-w-3xl">
      <Link
        href="/feed"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {s.feed}
      </Link>

      <Card plain className="mt-4">
        <div className="flex items-center gap-4">
          <Avatar name={profile.name} url={profile.avatar_url} size="h-16 w-16" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl font-extrabold tracking-tight">{profile.name}</h1>
            {profile.username ? <p className="mt-0.5 truncate text-[13px] text-ink-faint">@{profile.username}</p> : null}
            {profile.follows_me ? (
              <p className="mt-1 inline-block rounded-full bg-bg px-2.5 py-0.5 text-[11px] font-semibold text-ink-faint">{s.followsYou}</p>
            ) : null}
          </div>
          {!profile.me ? <FollowButton userId={profile.id} following={profile.is_following} /> : null}
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
          {stats.map(([label, value, href]) =>
            href ? (
              <Link key={label} href={href} className="min-w-0 rounded-2xl bg-bg px-2 py-3 hover:bg-accent-soft">
                {stat(label, value)}
              </Link>
            ) : (
              <div key={label} className="min-w-0 rounded-2xl bg-bg px-2 py-3">
                {stat(label, value)}
              </div>
            ),
          )}
        </dl>

        {streak.longest > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
            <span className="flex items-center gap-1.5 font-semibold">
              <NavIcon d={FLAME} className="h-[17px] w-[17px] text-accent" />
              <span className="tabular-nums">{streak.current === 1 ? st.dayStreakOne : fill(st.dayStreak, { count: streak.current })}</span>
            </span>
            <span className="flex items-center gap-1.5 text-ink-soft">
              <NavIcon d={TROPHY} className="h-[17px] w-[17px] text-ink-faint" />
              <span className="tabular-nums">{streak.longest === 1 ? st.bestOne : fill(st.best, { count: streak.longest })}</span>
            </span>
          </div>
        ) : null}
      </Card>

      <h2 className="mt-6 text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{s.yourPosts}</h2>
      <div className="mt-3 space-y-4">
        {posts.items.length === 0 ? (
          <p className="text-[13px] text-ink-faint">—</p>
        ) : (
          posts.items.map((p) => <PostCard key={p.id} post={p} />)
        )}
      </div>
    </div>
  );
}
