import type { CoachMarketplaceV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { SITE_URL } from "@/lib/brand";
import { formatBookingTime } from "@/lib/booking";
import { marketplaceState, profileCompleteness } from "@/lib/coach-completeness";
import { getMyCoachProfile } from "@/lib/coach-profile-data";
import { getProfile } from "@/lib/data";
import { getLocale } from "@/lib/i18n/server";
import { getMarketplaceOverview } from "@/lib/marketplace-data";

// The coach's marketplace — the web's /marketplace: the same two reads
// (the coach's own profile for completeness, coach_marketplace_overview() for
// every count) and the same state and completeness rules, already applied.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [me, mine, o, locale] = await Promise.all([getProfile(), getMyCoachProfile(), getMarketplaceOverview(), getLocale()]);
  const empty = { pending: 0, accepted: 0 };
  if (!mine || !o?.profile) {
    return apiJson<CoachMarketplaceV1>({
      has_profile: false, state: null, revision_status: null, verified: false, public_url: null, completeness: null,
      requests: o?.requests ?? empty,
      bookings: { pending: 0, upcoming: 0, needs_outcome: 0, next: null },
      clients: { active: o?.clients.active ?? 0, invited: o?.clients.invited ?? 0, paused: o?.clients.paused ?? 0 },
      messages: o?.messages ?? { unread: 0, conversations_unread: 0 },
      services: { active: 0, bookable: 0 },
      reviews: { count: 0, avg: null, latest: [] },
    });
  }
  const p = o.profile;
  const completeness = profileCompleteness(mine, {
    hasAvatar: Boolean(me?.avatar_url), availabilityBlocks: o.availability.blocks, bookableServices: o.services?.bookable ?? 0,
  });
  const next = o.bookings.next ? formatBookingTime(o.bookings.next, locale) : null;
  return apiJson<CoachMarketplaceV1>({
    has_profile: true,
    state: marketplaceState(p.status, mine.missing),
    revision_status: p.revision_status,
    verified: p.verification_status === "verified",
    public_url: p.status === "published" ? `${SITE_URL}/coaches/${p.slug}` : null,
    completeness: { pct: completeness.pct, items: completeness.items.map((i) => ({ key: i.key, done: i.done, required: i.required, earned: i.earned, weight: i.weight })) },
    requests: o.requests,
    bookings: {
      pending: o.bookings.pending, upcoming: o.bookings.upcoming, needs_outcome: o.bookings.needs_outcome,
      next: next && o.bookings.next ? { when: `${next.date} ${next.time}`, client: o.bookings.next.client_name, service: o.bookings.next.service_name } : null,
    },
    clients: { active: o.clients.active, invited: o.clients.invited, paused: o.clients.paused ?? 0 },
    messages: o.messages,
    services: { active: o.services?.active ?? 0, bookable: o.services?.bookable ?? 0 },
    reviews: {
      count: p.review_count,
      avg: p.review_avg === null ? null : new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(p.review_avg)),
      latest: o.reviews.latest.map((r) => ({ id: r.id, rating: r.rating, body: r.body, reviewer_name: r.reviewer_name })),
    },
  });
});
