import { landingIndexable } from "./coach-discovery";

/**
 * robots.txt and sitemap.xml for the public surface (20261107100000). Pure,
 * so the rules are unit-tested; app/robots.ts and app/sitemap.ts only feed
 * them. Public = the landing page, the coach directory and published coach
 * pages; everything else needs an account and is kept out of the crawl.
 */

/**
 * Paths a crawler should not spend time on: the signed-in app (every one of
 * these sends an anonymous request to /login anyway) and the reader-specific
 * corners of /coaches. Matching is by prefix, so a coach's own surface is
 * written "/coach/" — a bare "/coach" would also match "/coaches".
 */
export const ROBOTS_DISALLOW = [
  "/api/", "/auth/", "/admin", "/login", "/complete-profile", "/reset-password", "/suspended", "/offline", "/serwist/",
  // coach desk
  "/dashboard", "/clients", "/programs", "/library", "/nutrition", "/requests", "/bookings", "/reviews",
  "/check-ins", "/messages", "/settings",
  // client app
  "/today", "/workout", "/routines", "/food", "/habits", "/progress", "/check-in", "/challenges", "/achievements",
  "/feed", "/saved", "/notifications", "/coach/", "/coach$", "/billing", "/account", "/people", "/welcome", "/streak",
  // the directory's private corners, and its per-reader steps
  "/coaches/requests", "/coaches/saved", "/coaches/bookings", "/coaches/*/book", "/coaches/*/review",
] as const;

export function robotsRules(siteUrl: string) {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/coaches"], disallow: [...ROBOTS_DISALLOW] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}

export type SitemapEntry = { url: string; lastModified?: Date; changeFrequency?: "daily" | "weekly"; priority?: number };

/**
 * The landing page, the directory, every landing listing that lists someone
 * (/coaches/<city | specialization | country>, 20261111110000) and one entry
 * per indexable coach (coach_sitemap()). Never a filtered /coaches?… URL.
 */
export function sitemapEntries(
  siteUrl: string, coaches: { slug: string; last_modified: string | null }[], landings: string[] = [],
): SitemapEntry[] {
  return [
    { url: siteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/coaches`, changeFrequency: "daily", priority: 0.9 },
    ...[...new Set(landings)].map((slug) => ({
      url: `${siteUrl}/coaches/${encodeURIComponent(slug)}`, changeFrequency: "daily" as const, priority: 0.85,
    })),
    ...coaches.map((c) => ({
      url: `${siteUrl}/coaches/${encodeURIComponent(c.slug)}`,
      ...(c.last_modified ? { lastModified: new Date(c.last_modified) } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

// ---------- landing listings (20261111110000) ----------

type Locale = "en" | "ro";
export type LandingCopy = {
  cityTitle: string; cityIntro: string; specializationTitle: string; specializationIntro: string; countryTitle: string; countryIntro: string;
  metaCity: string; metaSpecialization: string; metaCountry: string;
};
const fillN = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));

/** The H1 and the intro of a landing listing, in the reader's language. */
export function landingCopy(l: { kind: "city" | "specialization" | "country"; name: string }, copy: LandingCopy) {
  const v = { place: l.name, name: l.name };
  if (l.kind === "city") return { title: fillN(copy.cityTitle, v), intro: fillN(copy.cityIntro, v) };
  if (l.kind === "country") return { title: fillN(copy.countryTitle, v), intro: fillN(copy.countryIntro, v) };
  return { title: fillN(copy.specializationTitle, v), intro: fillN(copy.specializationIntro, v) };
}

/**
 * A landing listing's metadata: its own canonical address (never the
 * /coaches?… equivalent), indexable only with LANDING_MIN_COACHES or more, a
 * description with the real count, Open Graph / Twitter for link previews.
 */
export function landingMetadata(
  l: { kind: "city" | "specialization" | "country"; slug: string; name: string; coaches: number },
  opts: { siteUrl: string; appName: string; locale: Locale; copy: LandingCopy },
) {
  const url = `${opts.siteUrl}/coaches/${l.slug}`;
  const { title: h1 } = landingCopy(l, opts.copy);
  const title = `${h1} | ${opts.appName}`;
  const v = { place: l.name, name: l.name, n: l.coaches };
  const description = l.kind === "city" ? fillN(opts.copy.metaCity, v)
    : l.kind === "country" ? fillN(opts.copy.metaCountry, v) : fillN(opts.copy.metaSpecialization, v);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: landingIndexable(l) ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "website" as const, url, title, description, siteName: opts.appName, locale: opts.locale === "ro" ? "ro_RO" : "en_GB" },
    twitter: { card: "summary" as const, title, description },
  };
}

/** schema.org for a landing listing: a CollectionPage of the coaches shown, and its breadcrumb. */
export function landingJsonLd(
  l: { slug: string; title: string }, coaches: { slug: string; name: string }[], siteUrl: string, labels: { home: string; coaches: string },
) {
  const url = `${siteUrl}/coaches/${l.slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage", url, name: l.title,
        mainEntity: {
          "@type": "ItemList",
          itemListElement: coaches.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: `${siteUrl}/coaches/${c.slug}`, name: c.name })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: labels.home, item: siteUrl },
          { "@type": "ListItem", position: 2, name: labels.coaches, item: `${siteUrl}/coaches` },
          { "@type": "ListItem", position: 3, name: l.title, item: url },
        ],
      },
    ],
  };
}
