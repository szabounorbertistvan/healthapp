import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";
import { sitemapEntries } from "@/lib/seo";
import { supabasePublic } from "@/lib/supabase/server";

// Read at request time (cached for an hour below), never at build: the CI
// build runs without Supabase credentials, and a coach approved today should
// not wait for a deploy to be listed.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

/**
 * /sitemap.xml — the landing page, the directory and every indexable coach
 * (coach_sitemap(), 20261107100000: published, account live, the essentials
 * still there). A database without the function, or any read failure, still
 * answers a valid sitemap of the two public pages rather than a 500.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let coaches: { slug: string; last_modified: string | null }[] = [];
  try {
    const { data, error } = await supabasePublic().rpc("coach_sitemap", { p_limit: 50000, p_offset: 0 });
    if (error) console.error("sitemap: coach_sitemap failed:", error.message);
    else coaches = (data ?? []) as typeof coaches;
  } catch (e) {
    console.error("sitemap:", e);
  }
  return sitemapEntries(SITE_URL, coaches);
}
