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
  getCoachSlugRedirect, getCoachViewerState, getDiscoveryFacets, getPublicCoachPosts, getPublicCoachPrograms, getPublicCoachProfile,
  searchCoaches,
} from "@/lib/coach-profile-data";
import {
  TEASER_PROGRAMS, TEASER_REVIEWS, attributionParams, coachGateHref, coachPageJsonLd, coachPageMetadata, coachTeaser,
  startCoachingState,
} from "@/lib/coach-public";
import { landingFor, landingIndexable, type DiscoveryLanding } from "@/lib/coach-discovery";
import { landingCopy, landingJsonLd, landingMetadata } from "@/lib/seo";
import { zoneLabel } from "@/lib/booking";
import { DiscoveryListing } from "@/components/coach-discovery/listing";
import { CoachSearchBox } from "@/components/coach-discovery/controls";
import { ShareCoachButton } from "@/components/coach-profile/share-button";
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

/**
 * Every read here goes through coach_public_profile(); nothing unpublished is
 * ever a page. A slug that is not a coach may be a landing listing — a city,
 * a specialization or a country (they share the namespace, 20261020100000).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, { t, locale }] = await Promise.all([params, getI18n()]);
  const profile = await getPublicCoachProfile(slug);
  if (profile) {
    // a published coach is indexable; one that lost the essentials publishing
    // required (an avatar removed after approval…) is not (20261107100000)
    return coachPageMetadata(profile, { siteUrl: SITE_URL, appName: APP_NAME, locale });
  }
  const landing = landingFor(slug, await getDiscoveryFacets(), locale);
  if (landing) return landingMetadata(landing, { siteUrl: SITE_URL, appName: APP_NAME, locale, copy: t.coachProfile.discovery.landing });
  return { title: `${t.coachProfile.publicPage.notFoundTitle} | ${APP_NAME}`, robots: { index: false, follow: false } };
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
    // a city, a specialization or a country: the indexable landing listing (20261111110000)
    const landing = landingFor(slug, await getDiscoveryFacets(), locale);
    if (landing) return <Landing landing={landing} signedIn={signedIn} />;
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
    <Link href={loginHref} title={p.signInToFollow} data-mkt-wall="follow"
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

  // when the coach can be booked: formatted here, in the coach's zone, so server and browser draw the same text
  const avail = profile.availability;
  const firstBook = Object.values(bookHrefs)[0] ?? null;
  const availability = avail ? {
    bookable: avail.bookable && firstBook !== null,
    nextSlot: avail.next_slot_at && avail.timezone
      ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
          timeZone: avail.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        }).format(new Date(avail.next_slot_at))
      : null,
    zone: avail.timezone ? zoneLabel(avail.timezone) : null,
    href: firstBook,
  } : null;
  const share = viewer?.is_self ? null : (
    <ShareCoachButton url={`${SITE_URL}/coaches/${profile.slug}`} name={name} slug={profile.slug} />
  );

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
          reviews={reviewsSection} gate={gate} headerRating={headerRating} share={share} availability={availability} />
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

/**
 * /coaches/<city | specialization | country> — a landing listing: the same
 * listing as /coaches?city=… (the one ranking, the same filters), at an
 * address of its own with an H1, an intro and a canonical URL, indexable
 * while it lists someone. The filters on it lead into /coaches?… — those
 * combinations stay noindex.
 */
async function Landing({ landing, signedIn }: { landing: DiscoveryLanding; signedIn: boolean }) {
  const { t } = await getI18n();
  const d = t.coachProfile.discovery;
  const [result, facets] = await Promise.all([searchCoaches(landing.query), getDiscoveryFacets()]);
  const { title, intro } = landingCopy(landing, d.landing);
  const jsonLd = landingJsonLd({ slug: landing.slug, title }, result.items.map((c) => ({ slug: c.slug, name: c.display_name })), SITE_URL,
    { home: APP_NAME, coaches: d.backToDiscover });
  return (
    <div data-testid="coach-landing" data-kind={landing.kind} data-indexable={landingIndexable(landing)}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketplaceTracker view="directory_view" city={landing.kind === "city" ? landing.slug : null}
        specialization={landing.kind === "specialization" ? landing.slug : null} />
      <section className="mx-auto max-w-3xl pb-5 pt-2 text-center sm:pb-10 sm:pt-8">
        <nav aria-label="breadcrumb" className="text-[13px] font-semibold text-ink-faint">
          <Link href="/coaches" className="hover:text-ink">{d.backToDiscover}</Link> <span aria-hidden>/</span> <span>{landing.name}</span>
        </nav>
        <h1 className="mt-2 font-display text-[24px] font-extrabold leading-tight tracking-tight sm:text-[40px]">{title}</h1>
        <p className="mx-auto mt-3 max-w-[60ch] text-[15px] text-ink-soft sm:text-[16px]">{intro}</p>
        <div className="mt-4 text-left sm:mt-8"><CoachSearchBox query={landing.query} /></div>
      </section>
      <DiscoveryListing query={landing.query} result={result} facets={facets} signedIn={signedIn} label={landing.name} />
    </div>
  );
}
