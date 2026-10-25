import type { CoachSearchV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { EMPTY_QUERY, hasMore, toCoachCard, type DiscoveryQuery } from "@/lib/coach-discovery";
import { getDiscoveryFacets, getSavedCoaches, searchCoaches } from "@/lib/coach-profile-data";
import { formatPrice } from "@/lib/coach-onboarding";
import { getLocale } from "@/lib/i18n/server";

// Finding a coach — the web's /coaches listing: search_coaches() with the text,
// online / in person, one specialization, "include coaches not taking clients",
// a page; or ?saved=1, the reader's own shortlist. The order is coach_ranked(),
// never re-sorted here.
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const spec = q.get("spec");
  const query: DiscoveryQuery = {
    ...EMPTY_QUERY,
    q: (q.get("q") ?? "").trim().slice(0, 100),
    online: q.get("online") === "1",
    inPerson: q.get("in_person") === "1",
    specializations: spec && SLUG.test(spec) ? [spec] : [],
    accepting: q.get("all") !== "1",
    page: Math.min(10, Math.max(1, Number(q.get("page")) || 1)),
    browse: true,
  };
  const [locale, facets, result] = await Promise.all([
    getLocale(),
    getDiscoveryFacets(),
    q.get("saved") === "1" ? getSavedCoaches() : searchCoaches(query),
  ]);
  return apiJson<CoachSearchV1>({
    total: result.total,
    has_more: q.get("saved") === "1" ? false : hasMore(result.total, query),
    items: result.items.map((row) => {
      const c = toCoachCard(row, locale);
      return {
        slug: row.slug,
        name: c.name,
        avatar_url: c.avatarUrl,
        headline: c.headline,
        verified: c.verified,
        city: c.city,
        formats: c.formats,
        years: c.years,
        specializations: c.specializations,
        more_specializations: c.moreSpecializations,
        starting_price: c.startingPrice ? formatPrice(c.startingPrice.cents, c.startingPrice.currency, locale) : null,
        accepting: c.accepting,
        rating: c.rating,
        profile_id: c.profileId,
        saved: c.save ? c.save.saved : null,
        available_soon: c.availableSoon,
      };
    }),
    specializations: facets.specializations
      .filter((s) => (s.coaches ?? 0) > 0)
      .map((s) => ({ slug: s.slug, name: locale === "ro" ? s.name_ro : s.name_en, coaches: s.coaches ?? 0 })),
  });
});
