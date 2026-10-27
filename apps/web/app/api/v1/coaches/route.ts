import type { CoachSearchV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { EMPTY_QUERY, hasMore, landingFor, toCoachCard, type DiscoveryQuery } from "@/lib/coach-discovery";
import { getDiscoveryFacets, getSavedCoaches, searchCoaches } from "@/lib/coach-profile-data";
import { formatPrice } from "@/lib/coach-onboarding";
import { getI18n } from "@/lib/i18n/server";
import { landingCopy } from "@/lib/seo";

// Finding a coach — the web's /coaches listing: search_coaches() with the text,
// online / in person, one specialization, "include coaches not taking clients",
// a city or a country, a page; ?landing=<slug> the city / specialization /
// country listing /coaches/<slug> is on the web; or ?saved=1, the reader's own shortlist. The order is coach_ranked(),
// never re-sorted here.
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const spec = q.get("spec");
  const slugParam = (name: string) => {
    const v = q.get(name);
    return v && SLUG.test(v) ? v : null;
  };
  const [{ t, locale }, facets] = await Promise.all([getI18n(), getDiscoveryFacets()]);
  const landingSlug = slugParam("landing");
  const landing = landingSlug ? landingFor(landingSlug, facets, locale) : null;
  const query: DiscoveryQuery = {
    ...EMPTY_QUERY,
    q: (q.get("q") ?? "").trim().slice(0, 100),
    online: q.get("online") === "1",
    inPerson: q.get("in_person") === "1",
    specializations: spec && SLUG.test(spec) ? [spec] : [],
    city: slugParam("city"),
    country: slugParam("country"),
    accepting: q.get("all") !== "1",
    page: Math.min(10, Math.max(1, Number(q.get("page")) || 1)),
    browse: true,
    // a landing listing is that query (the web's /coaches/<slug>), with the same page and filters on top
    ...(landing ? { city: landing.query.city ?? null, country: landing.query.country ?? null, specializations: landing.query.specializations.length ? landing.query.specializations : spec && SLUG.test(spec) ? [spec] : [] } : {}),
  };
  const result = await (q.get("saved") === "1" ? getSavedCoaches() : searchCoaches(query));
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
    cities: facets.cities
      .filter((c) => c.coaches > 0)
      .sort((a, b) => b.coaches - a.coaches)
      .map((c) => ({ slug: c.slug, name: locale === "ro" ? c.name : c.name_en, coaches: c.coaches })),
    landing: landing ? { kind: landing.kind, slug: landing.slug, name: landing.name, ...landingCopy(landing, t.coachProfile.discovery.landing) } : null,
  });
});
