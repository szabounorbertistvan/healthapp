import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_NAME, SITE_URL } from "@/lib/brand";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import {
  getCoachViewerState, getPublicCoachPosts, getPublicCoachPrograms, getPublicCoachProfile,
} from "@/lib/coach-profile-data";
import { coachJsonLd, coachPageDescription, coachPageTitle, startCoachingState } from "@/lib/coach-public";
import { getFeed } from "@/lib/social-data";
import { getProfileRoutines } from "@/lib/routine-data";
import { CoachProfileView, CoachSection } from "@/components/coach-profile/preview";
import { CoachSectionSkeleton } from "@/components/coach-profile/skeleton";
import { StartCoachingProvider } from "@/components/coach-profile/start-coaching";
import { PublicPostList } from "@/components/coach-profile/public-posts";
import { FollowButton, PostCard } from "@/components/social";
import { RoutineCardView } from "@/components/routine-card";
import type { RoutineCard } from "@healthapp/shared";

type Props = { params: Promise<{ slug: string }> };

/** Every read here goes through coach_public_profile(); nothing unpublished is ever a page. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, { t, locale }] = await Promise.all([params, getI18n()]);
  const profile = await getPublicCoachProfile(slug);
  if (!profile) return { title: `${t.coachProfile.publicPage.notFoundTitle} | ${APP_NAME}`, robots: { index: false, follow: false } };
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
      ...(profile.username ? { username: profile.username } : {}),
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
 *
 * Round trips: an anonymous reader's three reads all take the slug, so they
 * run side by side (one wave). A signed-in reader's need the profile's ids
 * first: the viewer state is awaited (the buttons depend on it), the posts
 * and programs stream in behind skeletons. Posts and programs are capped (3
 * and 6), never a history. There is no route loading.tsx: it would start the
 * response before notFound(), and an unknown or private coach must stay a 404.
 */
export default async function CoachPage({ params }: Props) {
  const [{ slug }, { locale }, viewerId] = await Promise.all([params, getI18n(), currentUserId()]);
  const signedIn = Boolean(viewerId);
  // the public doors return nothing for a slug that is not a published coach, so they can start with the profile
  const [profile, publicPosts, publicPrograms] = await Promise.all([
    getPublicCoachProfile(slug),
    signedIn ? Promise.resolve([]) : getPublicCoachPosts(slug),
    signedIn ? Promise.resolve([]) : getPublicCoachPrograms(slug),
  ]);
  if (!profile) notFound();
  if (slug !== profile.slug) notFound();

  const coachId = profile.user_id; // set for a signed-in reader only
  const viewer = signedIn ? await getCoachViewerState(profile.id) : null;
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

  const name = profile.display_name;
  const postsTitle = fill(p.postsBy, { name });
  const programsTitle = fill(p.programsBy, { name });
  // anonymous: the public doors, already loaded; signed in: the social system's own reads, streamed
  const posts = signedIn && coachId ? (
    <Suspense fallback={<CoachSectionSkeleton cards={1} />}>
      <SignedInPosts coachId={coachId} title={postsTitle} allHref={allPostsHref} seeAll={p.seeAllPosts} />
    </Suspense>
  ) : publicPosts.length > 0 ? (
    <CoachSection title={postsTitle} id="posts"><PublicPostList posts={publicPosts} allHref={allPostsHref} /></CoachSection>
  ) : null;
  const programs = signedIn && coachId ? (
    <Suspense fallback={<CoachSectionSkeleton />}>
      <SignedInPrograms coachId={coachId} title={programsTitle} />
    </Suspense>
  ) : publicPrograms.length > 0 ? (
    <CoachSection title={programsTitle} id="programs"><ProgramGrid cards={publicPrograms} showSave={false} /></CoachSection>
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
        <CoachProfileView profile={profile} follow={follow} posts={posts} programs={programs} live />
      </StartCoachingProvider>
    </>
  );
}

function ProgramGrid({ cards, showSave }: { cards: RoutineCard[]; showSave: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => <RoutineCardView key={card.id} card={card} showSave={showSave} />)}
    </div>
  );
}

/** The coach's posts as the feed shows them to this reader (kudos, comments, pictures) — the first three. */
async function SignedInPosts({ coachId, title, allHref, seeAll }: { coachId: string; title: string; allHref: string; seeAll: string }) {
  const feed = await getFeed({ author: coachId });
  if (feed.items.length === 0) return null;
  return (
    <CoachSection title={title} id="posts">
      <div className="grid gap-3">
        {feed.items.slice(0, 3).map((post) => <PostCard key={post.id} post={post} />)}
        <Link href={allHref} className="text-[14px] font-semibold text-accent-ink hover:underline">{seeAll} →</Link>
      </div>
    </CoachSection>
  );
}

/** The coach's programs this reader may see (social_profile_programs), with Save. */
async function SignedInPrograms({ coachId, title }: { coachId: string; title: string }) {
  const cards = await getProfileRoutines(coachId);
  if (cards.length === 0) return null;
  return <CoachSection title={title} id="programs"><ProgramGrid cards={cards} showSave /></CoachSection>;
}
