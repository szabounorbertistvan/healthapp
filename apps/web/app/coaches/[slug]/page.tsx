import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { classifyAttribution } from "@healthapp/shared";
import { notFound, permanentRedirect } from "next/navigation";
import { APP_NAME, SITE_URL } from "@/lib/brand";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { currentUserId } from "@/lib/supabase/server";
import {
  getCoachSlugRedirect, getCoachViewerState, getPublicCoachPosts, getPublicCoachPrograms, getPublicCoachProfile,
} from "@/lib/coach-profile-data";
import {
  TEASER_PROGRAMS, TEASER_REVIEWS, attributionParams, coachGateHref, coachIndexable, coachPageDescription, coachPageJsonLd,
  coachPageTitle, coachTeaser, startCoachingState,
} from "@/lib/coach-public";
import { MarketplaceTracker } from "@/components/marketplace-tracker";
import { ModerationMenuButton } from "@/components/moderation";
import { ratingLabel } from "@/lib/coach-review";
import { getProfile } from "@/lib/data";
import { PublicProfileGate } from "@/components/coach-profile/public-gate";
import { SaveIntent } from "@/components/coach-profile/intent";
import { getFeed } from "@/lib/social-data";
import { getProfileRoutines } from "@/lib/routine-data";
import { CoachProfileView, CoachSection } from "@/components/coach-profile/preview";
import { getBookableServices } from "@/lib/booking-data";
import { getMyReviewState, getPublicReviews } from "@/lib/review-data";
import { PublicReviewsSection } from "@/components/coach-reviews";
import { CoachSectionSkeleton } from "@/components/coach-profile/skeleton";
import { StartCoachingProvider } from "@/components/coach-profile/start-coaching";
import { PublicPostList } from "@/components/coach-profile/public-posts";
import { FollowButton, PostCard } from "@/components/social";
import { SaveCoachButton } from "@/components/coach-discovery/save-coach-button";
import { RoutineCardView } from "@/components/routine-card";
import type { RoutineCard } from "@healthapp/shared";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ intent?: string; service?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string }>;
};

/** Every read here goes through coach_public_profile(); nothing unpublished is ever a page. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, { t, locale }] = await Promise.all([params, getI18n()]);
  const profile = await getPublicCoachProfile(slug);
  if (!profile) return { title: `${t.coachProfile.publicPage.notFoundTitle} | ${APP_NAME}`, robots: { index: false, follow: false } };
  const url = `${SITE_URL}/coaches/${profile.slug}`;
  const title = coachPageTitle(profile, locale, APP_NAME);
  const description = coachPageDescription(profile, locale);
  const images = profile.cover_url ?? profile.avatar_url;
  const imageAlt = profile.headline ? `${profile.display_name} — ${profile.headline}` : profile.display_name;
  return {
    title,
    description,
    alternates: { canonical: url },
    // a published coach is indexable; one that lost the essentials publishing
    // required (an avatar removed after approval…) is not (20261107100000)
    robots: coachIndexable(profile) ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: "profile",
      ...(profile.username ? { username: profile.username } : {}),
      url,
      title,
      description,
      siteName: APP_NAME,
      locale: locale === "ro" ? "ro_RO" : "en_GB",
      ...(images ? { images: [{ url: images, alt: imageAlt }] } : {}),
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
export default async function CoachPage({ params, searchParams }: Props) {
  const [{ slug }, { locale }, viewerId] = await Promise.all([params, getI18n(), currentUserId()]);
  const signedIn = Boolean(viewerId);
  // the public doors return nothing for a slug that is not a published coach, so they can start with the profile
  const [profile, publicPosts, publicPrograms, bookable, reviews] = await Promise.all([
    getPublicCoachProfile(slug),
    signedIn ? Promise.resolve([]) : getPublicCoachPosts(slug),
    // anonymous: a few, the rest is behind the gate
    signedIn ? Promise.resolve([]) : getPublicCoachPrograms(slug, TEASER_PROGRAMS),
    // bookable services take the slug too, so they ride the same wave (20261105100000)
    getBookableServices(slug),
    // reviews by slug too (20261106100000): aggregates + the newest page, same wave
    getPublicReviews(slug, signedIn ? 10 : TEASER_REVIEWS),
  ]);
  if (!profile) {
    // a link shared before the coach changed their slug keeps working (20261107100000)
    const moved = await getCoachSlugRedirect(slug);
    if (moved) permanentRedirect(`/coaches/${moved}`);
    notFound();
  }
  // Book only where this reader may (a clients-only service shows no button to anyone else)
  const bookHrefs = Object.fromEntries(bookable
    .filter((b) => b.can_book === "ok" || b.can_book === "CANNOT_BOOK_SELF")
    .map((b) => [b.service_id, `/coaches/${profile.slug}/book?${new URLSearchParams({ service: b.service_id })}`]));
  // one URL per coach: any other spelling of the slug goes to the canonical one
  if (slug !== profile.slug) permanentRedirect(`/coaches/${profile.slug}`);

  const coachId = profile.user_id; // set for a signed-in reader only
  // the reader's state and whether they may review this coach: one wave, both need the profile id
  const [viewer, reviewState, me] = signedIn
    ? await Promise.all([getCoachViewerState(profile.id), getMyReviewState(profile.id), getProfile()])
    : [null, null, null];
  // Anonymous: the teaser — who the coach is in full, the start of the rest,
  // cut on the server — and the gate back to this very page after sign-up.
  const teaser = signedIn ? null : coachTeaser(profile);
  const query = (await searchParams) ?? {};
  // where this visit came from (20261110120000): carried into the sign-in / sign-up links so a new
  // account remembers it; the page view itself is recorded by MarketplaceTracker in the browser
  const loginParams = signedIn ? {} : attributionParams(classifyAttribution({
    utmSource: query.utm_source, utmMedium: query.utm_medium, utmCampaign: query.utm_campaign,
    referrer: (await headers()).get("referer"), siteHost: new URL(SITE_URL).hostname,
  }));
  const intent = query.intent === "save" ? { kind: "save" as const, serviceId: null }
    : query.intent === "contact" ? { kind: "contact" as const, serviceId: typeof query.service === "string" ? query.service : null }
    : null;
  const shown = teaser?.profile ?? profile;
  const state = startCoachingState(profile, viewer, { signedIn });
  const loginHref = `/login?${new URLSearchParams({ next: `/coaches/${profile.slug}` })}`;
  const allPostsHref = coachId ? `/people/${coachId}` : loginHref;

  // follow: the existing button for a signed-in reader, sign-in for anyone else, nothing on your own page
  const { t } = await getI18n();
  const p = t.coachProfile.publicPage;
  const followButton = signedIn && coachId ? (
    <FollowButton userId={coachId} following={viewer?.is_following ?? false} followsMe={viewer?.follows_me ?? false} />
  ) : (
    <Link href={loginHref} title={p.signInToFollow}
      className="inline-flex h-12 items-center justify-center rounded-2xl bg-surface px-5 text-[14px] font-semibold text-ink hover:bg-accent-soft/60">
      {p.follow}
    </Link>
  );
  const name = profile.display_name;
  // Follow (public, social) and Save (a private shortlist) side by side; neither on your own page
  const follow = viewer?.is_self ? null : (
    <>
      {followButton}
      <SaveCoachButton variant="pill" profileId={profile.id} saved={viewer?.is_saved ?? false} signedIn={signedIn}
        signInNext={`/coaches/${profile.slug}?intent=save`} signInParams={loginParams} />
      {/* report the profile (20261110110000): the one reporting path, signed in only */}
      {signedIn ? (
        <span className="self-center">
          <ModerationMenuButton target={{ userId: coachId ?? "", name }} coachProfileId={profile.id}
            muted={false} blocked={false} place="coach" />
        </span>
      ) : null}
    </>
  );

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

  // shown when there is something to read or the reader may write; never an empty "0 reviews" box otherwise
  const reviewsSection = reviews.count > 0 || reviewState?.eligible || reviewState?.review ? (
    <CoachSection title={t.coachProfile.reviews.title} id="reviews">
      <PublicReviewsSection reviews={reviews} coachName={name} slug={profile.slug} state={reviewState} signedIn={signedIn} />
    </CoachSection>
  ) : null;

  const gate = !signedIn ? (
    <PublicProfileGate kind="anonymous" coachName={name} moreServices={teaser?.moreServices ?? 0}
      signupHref={coachGateHref(profile.slug, "signup", loginParams)} signinHref={coachGateHref(profile.slug, "signin", loginParams)} />
  ) : me && !me.username ? (
    // signed in through Google, profile not finished: actions need a username
    <PublicProfileGate kind="incomplete" coachName={name} moreServices={0}
      signupHref={`/complete-profile?${new URLSearchParams({ next: `/coaches/${profile.slug}` })}`} signinHref={null} />
  ) : null;
  const headerRating = ratingLabel(reviews, { one: t.coachProfile.reviews.one, many: t.coachProfile.reviews.many }, locale);

  const jsonLd = coachPageJsonLd(shown, SITE_URL, locale, { home: APP_NAME, coaches: t.coachProfile.discovery.backToDiscover });

  return (
    <>
      <script
        type="application/ld+json"
        // JSON.stringify of public fields only; "<" escaped so no text can close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {/* back from signing in with an intent (20261108100000): finish it, once */}
      {signedIn && intent?.kind === "save" && !viewer?.is_self ? (
        <SaveIntent profileId={profile.id} saved={viewer?.is_saved ?? false} slug={profile.slug} />
      ) : null}
      {viewer?.is_self ? null : <MarketplaceTracker view="profile_view" slug={profile.slug} />}
      <StartCoachingProvider profile={shown} viewer={viewer} state={state} loginParams={loginParams}
        intent={signedIn && intent?.kind === "contact" ? { kind: "contact", serviceId: intent.serviceId } : null}>
        <CoachProfileView profile={shown} follow={follow} posts={posts} programs={programs} live bookHrefs={bookHrefs}
          reviews={reviewsSection} gate={gate} headerRating={headerRating} />
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
