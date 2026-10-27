import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { shareChallenge } from "@/app/social-actions";

// Share a completed challenge to the feed — the web's ShareChallenge (only a
// joined, completed challenge; the action checks).
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown; visibility?: unknown } | null;
  if (!b || typeof b.id !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid challenge" }, 400);
  const result = await shareChallenge(b.id, typeof b.visibility === "string" ? b.visibility : undefined);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
