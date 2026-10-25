import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { publishFitnessScore } from "@/app/social-privacy-actions";

// Publish today's Fitness Score to the social profile — the web's publishFitnessScore().
export const dynamic = "force-dynamic";

export const POST = v1Route(async () => {
  const result = await publishFitnessScore();
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
