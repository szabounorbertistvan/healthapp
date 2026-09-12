import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeed, getSocialProfile } from "@/lib/social-data";
import { Card } from "@/components/ui";
import { Avatar, FollowButton, PostCard } from "@/components/social";
import { getI18n } from "@/lib/i18n/server";

/**
 * A person's public profile: name, follow counts, three aggregate numbers
 * and the posts the viewer is allowed to see. Nothing private — no weight,
 * no nutrition, no sets.
 */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const [profile, posts] = await Promise.all([getSocialProfile(id), getFeed({ author: id })]);
  if (!profile) notFound();
  const s = t.common.social;
  const stats: [string, number][] = [
    [s.followers, profile.followers],
    [s.followingCount, profile.following],
    [s.workouts, profile.workouts],
    [s.prs, profile.prs],
    [s.challenges, profile.challenges],
  ];
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/feed" className="text-xs font-semibold text-ink-faint hover:text-accent-ink">
        ← {s.feed}
      </Link>
      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={profile.name} url={profile.avatar_url} size="h-14 w-14" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold tracking-tight">{profile.name}</h1>
            {profile.username ? <p className="truncate text-sm text-ink-faint">@{profile.username}</p> : null}
            {profile.follows_me ? <p className="mt-0.5 text-xs text-ink-faint">{s.followsYou}</p> : null}
          </div>
          {!profile.me ? <FollowButton userId={profile.id} following={profile.is_following} /> : null}
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-bg px-2 py-2">
              <dd className="text-lg font-bold tabular-nums">{value}</dd>
              <dt className="text-[11px] text-ink-faint">{label}</dt>
            </div>
          ))}
        </dl>
      </Card>
      <h2 className="text-sm font-bold">{s.yourPosts}</h2>
      {posts.items.length === 0 ? (
        <p className="text-sm text-ink-faint">—</p>
      ) : (
        posts.items.map((p) => <PostCard key={p.id} post={p} />)
      )}
    </div>
  );
}
