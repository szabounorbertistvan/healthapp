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

/** The landing page, the directory, and one entry per indexable coach (coach_sitemap()). */
export function sitemapEntries(siteUrl: string, coaches: { slug: string; last_modified: string | null }[]): SitemapEntry[] {
  return [
    { url: siteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/coaches`, changeFrequency: "daily", priority: 0.9 },
    ...coaches.map((c) => ({
      url: `${siteUrl}/coaches/${encodeURIComponent(c.slug)}`,
      ...(c.last_modified ? { lastModified: new Date(c.last_modified) } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
