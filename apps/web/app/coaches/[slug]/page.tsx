import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_NAME, SITE_URL } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import {
  getCoachViewerState, getPublicCoachPosts, getPublicCoachPrograms, getPublicCoachProfile,
} from "@/lib/coach-profile-data";
import { coachJsonLd, coachPageDescription, coachPageTitle, startCoachingState } from "@/lib/coach-public";
import { getFeed } from "@/lib/social-data";
import { getProfileRoutines } from "@/lib/routine-data";
import { CoachProfileView } from "@/components/coach-profile/preview";
import { StartCoachingProvider } from "@/components/coach-profile/start-coaching";
import { PublicPostList } from "@/components/coach-profile/public-posts";
import { FollowButton, PostCard } from "@/components/social";
import { RoutineCardView } from "@/components/routine-card";

type Props = { params: Promise<{ slug: string }> };

/** Every read here goes through coach_public_profile(); nothing unpublished is ever a page. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, { locale }] = await Promise.all([params, getI18n()]);
  const profile = await getPublicCoachProfile(slug);
  if (!profile) return { title: APP_NAME, robots: { index: false, follow: false } };
  const url = `${SITE_URL}/coaches/${profile.slug}`;
  const title = coachPageTitle(profile, locale, APP_NAME);
  const description = coachPageDescription(profile, locale);
  const images = profile.cover_url ?? profile.avatar_url;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      url,
      title,
      description,
      siteName: APP_NAME,
      locale: locale === "ro" ? "ro_RO" : "en_GB",
      ...(images ? { images: [{ url: images }] } : {}),
    },
    twitter: {
      card: profile.cover_url ? "summary_large_image" : "summary",
      title,
      description,
      ...(images ? { images: [images] } : {}),
    },
  };
}

/**
 * /coaches/[slug] — a coach's public page (Coach Discovery). Public by design:
 * middleware lets it through without a session, and the data comes only from
 * coach_public_profile / coach_public_posts / coach_public_programs, which
 * return nothing for a profile that is not published.
 *
 * A signed-in reader gets more of the existing systems rather than copies:
 * the Social V2 PostCard (pictures, kudos, comments) and the routine cards
 * as the social profile shows them, the follow button, and their own state
 * (coach_viewer_state) for Start coaching.
 */
export default async function CoachPage({ params }: Props) {
  const [{ slug }, { locale }, viewerId] = await Promise.all([params, getI18n(), currentUserId()]);
  const profile = await getPublicCoachProfile(slug);
  if (!profile) notFound();
  if (slug !== profile.slug) notFound();

  const signedIn = Boolean(viewerId);
  const coachId = profile.user_id; // set for a signed-in reader only
  const [viewer, feed, routines, publicPosts, publicPrograms] = await Promise.all([
    signedIn ? getCoachViewerState(profile.id) : Promise.resolve(null),
    signedIn && coachId ? getFeed({ author: coachId }) : Promise.resolve(null),
    signedIn && coachId ? getProfileRoutines(coachId) : Promise.resolve([]),
    signedIn ? Promise.resolve([]) : getPublicCoachPosts(profile.slug),
    signedIn ? Promise.resolve([]) : getPublicCoachPrograms(profile.slug),
  ]);
  const state = startCoachingState(profile, viewer, { signedIn });
  const loginHref = `/login?${new URLSearchParams({ next: `/coaches/${profile.slug}` })}`;
  const allPostsHref = coachId ? `/people/${coachId}` : loginHref;

  // follow: the existing button for a signed-in reader, sign-in for anyone else, nothing on your own page
  const { t } = await getI18n();
  const p = t.coachProfile.publicPage;
  const follow = viewer?.is_self ? null : signedIn && coachId ? (
    <FollowButton userId={coachId} following={viewer?.is_following ?? false} followsMe={viewer?.follows_me ?? false} />
  ) : (
    <Link href={loginHref} title={p.signInToFollow}
      className="inline-flex h-12 items-center justify-center rounded-2xl bg-surface px-5 text-[14px] font-semibold text-ink hover:bg-accent-soft/60">
      {p.follow}
    </Link>
  );

  const posts = feed
    ? feed.items.length > 0 ? (
        <div className="grid gap-3">
          {feed.items.slice(0, 3).map((post) => <PostCard key={post.id} post={post} />)}
          <Link href={allPostsHref} className="text-[14px] font-semibold text-accent-ink hover:underline">{p.seeAllPosts} →</Link>
        </div>
      ) : null
    : publicPosts.length > 0 ? <PublicPostList posts={publicPosts} allHref={allPostsHref} /> : null;

  const cards = signedIn ? routines : publicPrograms;
  const programs = cards.length > 0 ? (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => <RoutineCardView key={card.id} card={card} showSave={signedIn} />)}
    </div>
  ) : null;

  const jsonLd = coachJsonLd(profile, `${SITE_URL}/coaches/${profile.slug}`, locale);

  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify of public fields only; "<" escaped so no text can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <StartCoachingProvider profile={profile} viewer={viewer} state={state}>
        <CoachProfileView profile={profile} follow={follow} posts={posts} programs={programs} />
      </StartCoachingProvider>
    </>
  );
}
