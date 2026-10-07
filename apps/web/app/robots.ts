import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";
import { robotsRules } from "@/lib/seo";

/** /robots.txt — the public directory and coach pages crawlable, the app not (lib/seo.ts). */
export default function robots(): MetadataRoute.Robots {
  return robotsRules(SITE_URL);
}
