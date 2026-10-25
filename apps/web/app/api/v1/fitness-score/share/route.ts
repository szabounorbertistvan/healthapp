import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { shareFitnessScore } from "@/app/social-privacy-actions";

// Post the fitness score to the feed — the web's shareFitnessScore(); the server recomputes the score.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { visibility?: unknown } | null;
  const r = await shareFitnessScore(typeof b?.visibility === "string" ? b.visibility : undefined);
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
