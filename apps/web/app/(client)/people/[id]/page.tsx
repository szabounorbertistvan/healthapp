import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeed, getMutualFollowers, getSocialProfile } from "@/lib/social-data";
import { getUserStreak } from "@/lib/streak-data";
import { fill } from "@/lib/i18n";
import { Card } from "@/components/ui";
import { Avatar, FollowButton, PostCard } from "@/components/social";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";
const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";

/** The post types the profile tabs list. `null` is "everything". */
const TABS = [
  { key: "posts", type: null },
  { key: "workouts", type: "workout" },
  { key: "prs", type: "pr" },
  { key: "challenges", type: "challenge_completed" },
] as const;

/**
 * A person's public profile: name, city, bio, follow counts, aggregate
 * numbers, the streak, who you both follow, and the posts the viewer is
 * allowed to see — in tabs, each paginated on its own cursor.
 *
 * Everything comes from social_profile() and the feed's own snapshots.
 * Nothing private: no weight, no nutrition, no sets.
 */
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; before?: string }>;
}) {
  const { t } = await getI18n();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = TABS.find((x) => x.key === query.tab) ?? TABS[0];

  const [profile, posts, streak, mutuals] = await Promise.all([
    getSocialProfile(id),
    getFeed({ author: id, type: tab.type, before: query.before ?? null }),
    getUserStreak(id),
    getMutualFollowers(id),
  ]);
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
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {profile.follows_me ? (
                <span className="rounded-full bg-bg px-2.5 py-0.5 text-[11px] font-semibold text-ink-faint">{s.followsYou}</span>
              ) : null}
              {profile.city ? (
                <span className="truncate text-[12px] text-ink-faint">{profile.city}</span>
              ) : null}
            </div>
          </div>
          {!profile.me ? <FollowButton userId={profile.id} following={profile.is_following} /> : null}
        </div>

        {profile.bio ? (
          <p className="mt-3.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-soft">{profile.bio}</p>
        ) : null}

        {/* "Followed by Maria and 3 others" — real edges, counted by
            social_mutual_followers in one query, never a request per person. */}
        {mutuals.total > 0 && mutuals.people[0] ? (
          <Link
            href={`/people/${profile.id}/followers`}
            className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-faint hover:text-accent-ink"
          >
            <span className="flex -space-x-2">
              {mutuals.people.slice(0, 3).map((person) => (
                <Avatar key={person.id} name={person.name} url={person.avatar_url} size="h-6 w-6 ring-2 ring-surface" />
              ))}
            </span>
            <span className="min-w-0 truncate">
              {mutuals.total === 1
                ? fill(s.mutualsOne, { name: mutuals.people[0].name })
                : fill(s.mutualsMany, { name: mutuals.people[0].name, count: mutuals.total - 1 })}
            </span>
          </Link>
        ) : null}

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

      {/* Recent activity, built from the person's own snapshot posts — the
          same rows the tabs below list. Nothing is derived from their logs. */}
      {posts.items.length > 0 && tab.key === "posts" ? (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-soft">{s.recentActivity}</h2>
          <ul className="mt-2.5 space-y-1.5">
            {posts.items.slice(0, 4).map((p) => (
              <li key={`activity-${p.id}`} className="flex items-baseline gap-2 text-[13px]">
                <span className="shrink-0 text-ink-faint">{ACTIVITY_ICON[p.type] ?? "•"}</span>
                <Link href={`/feed/${p.id}`} className="min-w-0 truncate hover:text-accent-ink">
                  {activityLine(p, s, st)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="mt-6 flex gap-1.5 overflow-x-auto pb-1" aria-label={s.tabPosts}>
        {TABS.map((x) => (
          <Link
            key={x.key}
            href={x.key === "posts" ? `/people/${profile.id}` : `/people/${profile.id}?tab=${x.key}`}
            aria-current={tab.key === x.key ? "page" : undefined}
            className={`inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[12.5px] font-semibold ${
              tab.key === x.key ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            {TAB_LABEL(s)[x.key]}
          </Link>
        ))}
      </nav>

      <div className="mt-3 space-y-4">
        {posts.items.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{s.noneOfThose}</p>
        ) : (
          posts.items.map((p) => <PostCard key={p.id} post={p} />)
        )}
      </div>

      {posts.next_cursor ? (
        <Link
          href={`/people/${profile.id}?tab=${tab.key}&before=${encodeURIComponent(posts.next_cursor)}`}
          className="mt-4 flex h-11 items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {s.loadMore}
        </Link>
      ) : null}
    </div>
  );
}

type Social = Awaited<ReturnType<typeof getI18n>>["t"]["common"]["social"];
type Streaks = Awaited<ReturnType<typeof getI18n>>["t"]["common"]["streaks"];

const TAB_LABEL = (s: Social): Record<(typeof TABS)[number]["key"], string> => ({
  posts: s.tabPosts,
  workouts: s.tabWorkouts,
  prs: s.tabPrs,
  challenges: s.tabChallenges,
});

/** One glyph per kind of thing that happened. */
const ACTIVITY_ICON: Record<string, string> = {
  workout: "💪",
  pr: "🏆",
  streak: "🔥",
  challenge_completed: "🎯",
  program: "📋",
  progress: "📈",
  text: "•",
};

/**
 * One line of recent activity, read from the post's own snapshot — never from
 * the author's sets, food or measurements.
 */
function activityLine(
  post: { type: string; payload: unknown; text: string | null },
  s: Social,
  streaks: Streaks,
): string {
  const p = post.payload as { kind?: string; name?: string; exercise?: string; weight_kg?: number; reps?: number; streak_days?: number; title_en?: string } | null;
  if (p?.kind === "workout") return p.name ?? s.tabWorkouts;
  if (p?.kind === "pr") return `${p.exercise ?? ""} ${p.weight_kg ?? ""} kg × ${p.reps ?? ""}`.trim();
  if (p?.kind === "streak") return fill(streaks.dayStreak, { count: p.streak_days ?? 0 });
  if (p?.kind === "challenge_completed") return p.title_en ?? s.tabChallenges;
  if (p?.kind === "program") return p.name ?? s.tabPosts;
  return post.text ?? s.tabPosts;
}
