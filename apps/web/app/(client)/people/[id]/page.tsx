import Link from "next/link";
import { notFound } from "next/navigation";
import { followState, summarizeAchievements } from "@healthapp/shared";
import { getFeed, getMutualFollowers, getProfileBadges, getSocialProfile } from "@/lib/social-data";
import { getProfileRoutines } from "@/lib/routine-data";
import { fill } from "@/lib/i18n";
import { Avatar, FollowButton, PostCard } from "@/components/social";
import { BadgeShelf } from "@/components/social-v2";
import { RoutineCardView } from "@/components/routine-card";
import { ModerationMenuButton } from "@/components/moderation";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";
import { SOCIAL } from "@/lib/social-ui";
import type { ProfileBadge } from "@/lib/types";

const BACK = "m15 6-6 6 6 6";
const FLAME = "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z";
const LOCK = "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z";

type Section = "posts" | "achievements" | "programs";

/** The post filters inside Posts. `null` is everything. */
const FILTERS = [
  { key: "all", type: null },
  { key: "workouts", type: "workout" },
  { key: "prs", type: "pr" },
  { key: "challenges", type: "challenge_completed" },
  { key: "achievements", type: "achievement" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * A person's social profile, read top to bottom like the big apps:
 *
 *   avatar · name · Posts / Followers / Following
 *   follow button and how the two of you relate (or Edit profile, on your own)
 *   bio, "Followed by …", activity and Fitness Score — as far as their privacy
 *   settings let this reader see
 *   tabs: Posts · Achievements · Programs — each only when there is something
 *   the reader may see behind it
 *
 * Every number comes from a security-definer RPC that applies the privacy
 * rule itself (social_profile, social_badges, social_profile_programs), so
 * what this page leaves out is also what a hand-made request gets back. An
 * account that is suspended or being deleted is a 404 to everyone else.
 *
 * One wave of reads, and only the active tab's list: the Posts tab does not
 * pay for the badges, nor Achievements for the posts.
 */
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; type?: string; before?: string }>;
}) {
  const { t, locale } = await getI18n();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Older links used ?tab=workouts etc. for the post filters; they still land.
  const legacy = FILTERS.find((f) => f.key === query.tab && f.key !== "achievements");
  const requested: Section =
    query.tab === "achievements" ? "achievements" : query.tab === "programs" ? "programs" : "posts";
  const filter = FILTERS.find((f) => f.key === (legacy?.key ?? query.type)) ?? FILTERS[0];

  const [profile, mutuals, routines, posts, badges] = await Promise.all([
    getSocialProfile(id),
    getMutualFollowers(id),
    getProfileRoutines(id),
    requested === "posts"
      ? getFeed({ author: id, type: filter.type, before: query.before ?? null })
      : Promise.resolve(null),
    requested === "achievements" ? getProfileBadges(id) : Promise.resolve([] as ProfileBadge[]),
  ]);
  if (!profile) notFound();
  const s = t.common.social;
  const st = t.common.streaks;

  // A tab exists only when there is something behind it this reader may see.
  const sections: { key: Section; label: string }[] = [
    { key: "posts", label: s.tabPosts },
    ...(profile.stats_visible ? [{ key: "achievements" as const, label: s.tabAchievements }] : []),
    ...(routines.length > 0 ? [{ key: "programs" as const, label: s.publicPrograms }] : []),
  ];
  const section = sections.some((x) => x.key === requested) ? requested : "posts";
  const sectionHref = (key: Section) => (key === "posts" ? `/people/${profile.id}` : `/people/${profile.id}?tab=${key}`);

  const relation = followState(profile);
  const relationLabel =
    relation === "mutual" ? s.relationMutual
    : relation === "follows_you" ? s.relationFollowsYou
    : null;

  const counts: { label: string; value: number; href: string | null }[] = [
    { label: s.postsCount, value: profile.posts, href: null },
    { label: s.followers, value: profile.followers, href: `/people/${profile.id}/followers` },
    { label: s.followingCount, value: profile.following, href: `/people/${profile.id}/following` },
  ];
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" });

  // Activity, in one line of words rather than a dashboard of tiles.
  const activity = profile.stats_visible
    ? [
        profile.workouts !== null ? `${nf.format(profile.workouts)} ${s.workouts.toLowerCase()}` : null,
        profile.prs !== null ? `${nf.format(profile.prs)} ${s.prs}` : null,
        profile.challenges !== null ? `${nf.format(profile.challenges)} ${s.challenges.toLowerCase()}` : null,
      ].filter((x): x is string => Boolean(x))
    : [];

  const action = profile.me ? (
    <Link
      href="/account"
      className="inline-flex h-10 min-w-[136px] items-center justify-center rounded-full border border-line bg-surface px-5 text-[13.5px] font-semibold text-ink hover:bg-bg"
    >
      {s.editProfile}
    </Link>
  ) : (
    <span className="flex items-center gap-1">
      {profile.blocked ? null : (
        <FollowButton userId={profile.id} following={profile.is_following} followsMe={profile.follows_me} />
      )}
      <ModerationMenuButton
        target={{ userId: profile.id, name: profile.name }}
        muted={profile.muted}
        blocked={profile.blocked}
        place="profile"
      />
    </span>
  );

  // Blocked by you: the page still opens — it is where you unblock from — but
  // shows nothing of them. The server already returned no posts, stats or
  // lists for it; this only says why the page is empty.
  if (profile.blocked) {
    return (
      <div className="mx-auto w-full max-w-[600px]">
        <Link
          href="/feed"
          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
          {s.feed}
        </Link>
        <header className="mt-5 flex items-center gap-4">
          <Avatar name={profile.name} url={profile.avatar_url} size="h-20 w-20 text-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[21px] font-extrabold leading-tight tracking-tight">{profile.name}</h1>
          </div>
          {action}
        </header>
        <div className="mt-5 rounded-2xl border border-line bg-surface px-5 py-6 text-center">
          <p className="font-semibold">{fill(t.common.moderation.blockedProfile, { name: profile.name })}</p>
          <p className="mt-1 text-[13px] text-ink-soft">{t.common.moderation.blockedProfileHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[600px]">
      <Link
        href="/feed"
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-4 text-[13px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {s.feed}
      </Link>

      <header className="mt-5">
        <div className="flex items-center gap-4 sm:gap-7">
          <Avatar name={profile.name} url={profile.avatar_url} size="h-20 w-20 text-2xl sm:h-28 sm:w-28 sm:text-3xl" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="min-w-0 truncate font-display text-[21px] font-extrabold leading-tight tracking-tight sm:text-[26px]">
                {profile.name}
              </h1>
              {/* On a wide screen the button sits beside the name. */}
              <span className="hidden sm:block">{action}</span>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-ink-faint">
              {[profile.username && profile.username !== profile.name ? `@${profile.username}` : null, profile.city]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {/* Server-side counts from social_profile, never rows counted here. */}
            <dl className="mt-2.5 flex gap-5 sm:gap-7">
              {counts.map((c) => {
                const body = (
                  <>
                    <dd className="text-[16px] font-bold tabular-nums leading-none sm:text-[17px]">{nf.format(c.value)}</dd>
                    <dt className="mt-1 text-[12px] text-ink-faint">{c.label}</dt>
                  </>
                );
                return c.href ? (
                  <Link key={c.label} href={c.href} className="flex min-h-11 flex-col justify-center rounded-lg hover:text-accent-ink">
                    {body}
                  </Link>
                ) : (
                  <div key={c.label} className="flex min-h-11 flex-col justify-center">{body}</div>
                );
              })}
            </dl>
          </div>
        </div>

        {/* On a phone: one row under the avatar — the button, and how you relate. */}
        <div className="mt-3.5 flex items-center gap-2.5 sm:mt-3">
          <span className="sm:hidden">{action}</span>
          {relationLabel ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-ink">{relationLabel}</span>
          ) : null}
        </div>

        {profile.bio ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-soft">{profile.bio}</p>
        ) : null}

        {/* "Followed by Maria and 3 others" — real edges, counted by
            social_mutual_followers in one query, never a request per person. */}
        {mutuals.total > 0 && mutuals.people[0] ? (
          <Link
            href={`/people/${profile.id}/followers`}
            className="mt-3 flex min-h-8 items-center gap-2 text-[12.5px] text-ink-faint hover:text-accent-ink"
          >
            <span className="flex -space-x-2">
              {mutuals.people.slice(0, 3).map((person) => (
                <Avatar key={person.id} name={person.name} url={person.avatar_url} size="h-6 w-6 ring-2 ring-bg" />
              ))}
            </span>
            <span className="min-w-0 truncate">
              {mutuals.total === 1
                ? fill(s.mutualsOne, { name: mutuals.people[0].name })
                : fill(s.mutualsMany, { name: mutuals.people[0].name, count: mutuals.total - 1 })}
            </span>
          </Link>
        ) : null}

        {!profile.stats_visible ? (
          // Said plainly rather than shown as zeros: zeros would be a lie about
          // someone who trains every day and simply keeps it to themselves.
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
            <NavIcon d={LOCK} className="h-4 w-4" />
            {fill(s.statsHiddenPrivate, { name: profile.name })}
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-soft">
            {activity.length > 0 ? <span className="tabular-nums">{activity.join(" · ")}</span> : null}
            {(profile.streak_days ?? 0) > 0 ? (
              <span className="flex items-center gap-1 font-semibold text-ink">
                <NavIcon d={FLAME} className="h-4 w-4 text-accent" />
                <span className="tabular-nums">
                  {profile.streak_days === 1 ? st.dayStreakOne : fill(st.dayStreak, { count: profile.streak_days ?? 0 })}
                </span>
              </span>
            ) : null}
          </div>
        )}

        {profile.fitness_score !== null ? (
          <p className="mt-3 inline-flex items-baseline gap-2 rounded-full bg-accent px-3.5 py-1.5 text-accent-fg">
            <span className="text-[11px] font-semibold uppercase tracking-wider opacity-75">{s.fitnessScore}</span>
            <span className="font-display text-[17px] font-black tabular-nums leading-none">{profile.fitness_score}</span>
            {profile.fitness_score_at ? (
              <span className="text-[11px] opacity-70">
                {fill(s.fitnessScorePublished, { date: df.format(new Date(profile.fitness_score_at)) })}
              </span>
            ) : null}
          </p>
        ) : null}
      </header>

      <nav
        className={`mt-5 grid border-b border-line ${sections.length === 3 ? "grid-cols-3" : sections.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}
        aria-label={s.profileTabs}
      >
        {sections.map((x) => (
          <Link
            key={x.key}
            href={sectionHref(x.key)}
            aria-current={section === x.key ? "page" : undefined}
            className={`-mb-px flex h-12 min-w-0 items-center justify-center border-b-2 px-2 text-[13.5px] font-semibold transition-colors ${
              section === x.key ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink-soft"
            }`}
          >
            <span className="truncate">{x.label}</span>
          </Link>
        ))}
      </nav>

      {section === "posts" && posts ? (
        <section className="mt-4">
          <nav className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label={s.postFilters}>
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? `/people/${profile.id}` : `/people/${profile.id}?type=${f.key}`}
                aria-current={filter.key === f.key ? "page" : undefined}
                className={`inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-[12.5px] font-semibold ${
                  filter.key === f.key ? "bg-accent text-accent-fg" : "border border-line bg-surface text-ink-soft hover:text-ink"
                }`}
              >
                {FILTER_LABEL(s)[f.key]}
              </Link>
            ))}
          </nav>
          <div className="mt-3 space-y-4">
            {posts.items.length === 0 ? (
              <p className="rounded-2xl border border-line bg-surface px-5 py-10 text-center text-[13.5px] text-ink-soft">
                {filter.type ? s.noPostsOfType : s.noPostsYet}
              </p>
            ) : (
              posts.items.map((p) => <PostCard key={p.id} post={p} />)
            )}
          </div>
          {posts.next_cursor ? (
            <Link
              href={`/people/${profile.id}?${new URLSearchParams({
                ...(filter.type ? { type: filter.key } : {}),
                before: posts.next_cursor,
              })}`}
              className="mt-4 flex h-11 items-center justify-center rounded-2xl border border-line bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink"
            >
              {s.loadMore}
            </Link>
          ) : null}
        </section>
      ) : null}

      {/* Achievements: the tab exists only when the stats are visible to this
          reader, and social_badges() applies the same rule itself. */}
      {section === "achievements" ? (
        <section id="achievements" className="mt-4 scroll-mt-24">
          {badges.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ul className="flex flex-wrap gap-1.5">
                  {summarizeAchievements(badges.map((b) => ({ ...b, earned: true }))).byCategory.map((c) => (
                    <li key={c.category} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-soft">
                      {t.common.achievements.categories[c.category]}
                      <span className="ml-1 tabular-nums text-ink-faint">{c.earned}</span>
                    </li>
                  ))}
                </ul>
                {profile.me ? (
                  <Link href="/achievements" className="text-[12.5px] font-semibold text-accent-ink hover:underline">
                    {t.common.achievements.seeAll}
                  </Link>
                ) : null}
              </div>
              <div className="mt-3">
                <BadgeShelf badges={badges} mine={profile.me} />
              </div>
            </>
          ) : (
            <p className="rounded-2xl border border-line bg-surface px-5 py-10 text-center text-[13.5px] text-ink-soft">
              {profile.me ? s.noAchievementsMine : s.noAchievements}
            </p>
          )}
        </section>
      ) : null}

      {section === "programs" ? (
        <section className="mt-4 grid gap-3 sm:grid-cols-2">
          {routines.map((card) => (
            <RoutineCardView key={card.id} card={card} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

type Social = Awaited<ReturnType<typeof getI18n>>["t"]["common"]["social"];

const FILTER_LABEL = (s: Social): Record<FilterKey, string> => ({
  all: s.feedAll,
  workouts: s.tabWorkouts,
  prs: s.tabPrs,
  challenges: s.tabChallenges,
  achievements: s.tabAchievements,
});
