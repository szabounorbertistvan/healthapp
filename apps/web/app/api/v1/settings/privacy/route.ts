import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { updateSocialPrivacy } from "@/app/social-privacy-actions";

// Who sees the social profile's numbers — the web's updateSocialPrivacy().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { stats?: unknown; fitnessScore?: unknown } | null;
  if (!b || typeof b.stats !== "string" || typeof b.fitnessScore !== "string") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid privacy" }, 400);
  }
  const result = await updateSocialPrivacy({ stats: b.stats, fitnessScore: b.fitnessScore });
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
