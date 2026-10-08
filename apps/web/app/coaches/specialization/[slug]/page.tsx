import { permanentRedirect } from "next/navigation";

/**
 * /coaches/specialization/<slug> → /coaches/<slug>, permanently. Landing listings live
 * at /coaches/<slug> (cities, countries and specializations share the coach
 * slug namespace, where "specialization" is reserved), so this longer spelling — the one
 * people and old links guess — is one 308 away from the canonical page,
 * never a duplicate of it. An unknown slug ends on that page's 404.
 */
export default async function SpecializationAlias({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  permanentRedirect(`/coaches/${encodeURIComponent(slug.toLowerCase())}`);
}
