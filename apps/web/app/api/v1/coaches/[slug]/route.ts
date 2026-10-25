import type { CoachPageV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getBookableServices } from "@/lib/booking-data";
import { getCoachViewerState, getPublicCoachProfile } from "@/lib/coach-profile-data";
import { formatPrice } from "@/lib/coach-onboarding";
import { startCoachingState, yearsOfExperience } from "@/lib/coach-public";
import { getLocale } from "@/lib/i18n/server";
import { getMyReviewState, getPublicReviews } from "@/lib/review-data";

// A coach's public page for the app — the web's /coaches/[slug] for a signed-in
// reader: coach_public_profile() (whose field list is the public contract), the
// bookable services and whether this reader may book each, the reviews, the
// reader's own state with this coach (startCoachingState) and their review.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const slug = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [profile, bookable, reviews, locale] = await Promise.all([getPublicCoachProfile(slug), getBookableServices(slug), getPublicReviews(slug, 10), getLocale()]);
  if (!profile) return apiError("not_found", 404);
  const [viewer, mine] = await Promise.all([getCoachViewerState(profile.id), getMyReviewState(profile.id)]);
  const noHours = profile.availability?.has_hours === false;
  const bookById = new Map(bookable.map((b) => [b.service_id, b]));
  const ro = locale === "ro";
  return apiJson<CoachPageV1>({
    id: profile.id,
    slug: profile.slug,
    name: profile.display_name,
    avatar_url: profile.avatar_url,
    cover_url: profile.cover_url,
    headline: profile.headline,
    about: profile.about,
    approach: profile.approach ?? null,
    experience_summary: profile.experience_summary ?? null,
    years: yearsOfExperience(profile.coaching_since),
    coaching_since: profile.coaching_since,
    accepting: profile.accepting_clients,
    online: profile.online,
    in_person: profile.in_person,
    verified: profile.verified === true,
    followers: profile.followers,
    specializations: profile.specializations.map((s) => (ro ? s.name_ro : s.name_en)),
    languages: profile.languages.map((l) => l.native_name || (ro ? l.name_ro : l.name_en)),
    locations: profile.locations.map((l) => ({ city: ro ? l.city : l.city_en, country: ro ? l.country_ro : l.country_en, gym: l.gym_name })),
    certifications: profile.certifications.map((c) => ({ name: c.name, issuer: c.issuer, year: c.year ?? null, verified: c.verified })),
    services: profile.services.map((s) => {
      const b = bookById.get(s.id);
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price_public && s.price_cents !== null ? formatPrice(s.price_cents, s.currency, locale) : null,
        duration: b ? `${b.duration_minutes} min` : null,
        book: b && !noHours ? b.can_book : null,
      };
    }),
    next_slot: profile.availability?.next_slot_at ?? null,
    timezone: profile.availability?.timezone ?? null,
    state: startCoachingState(profile, viewer, { signedIn: true }),
    pending_request_id: viewer?.pending_request?.id ?? null,
    has_other_coach: viewer?.has_other_coach === true,
    saved: viewer?.is_saved === true,
    reviews: {
      count: reviews.count,
      average: reviews.average === null ? null : Number(reviews.average),
      distribution: reviews.distribution,
      items: reviews.items.map((r) => ({
        id: r.id, rating: r.rating, body: r.body, created_at: r.created_at, reviewer_name: r.reviewer_name,
        reviewer_avatar: r.reviewer_avatar, basis: r.basis, coach_response: r.coach_response, is_mine: r.is_mine,
      })),
    },
    my_review: mine ? { eligible: mine.eligible, review: mine.review ? { id: mine.review.id, rating: mine.review.rating, body: mine.review.body, status: mine.review.status } : null } : null,
  });
});
