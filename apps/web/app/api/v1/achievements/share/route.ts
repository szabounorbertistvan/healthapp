import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { shareAchievement } from "@/app/social-privacy-actions";

// Share an earned badge to the feed — the web's ShareBadge (shareAchievement):
// the database checks the badge is the reader's own and earned.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { slug?: unknown; visibility?: unknown } | null;
  const r = await shareAchievement(typeof b?.slug === "string" ? b.slug : "", typeof b?.visibility === "string" ? b.visibility : undefined);
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
