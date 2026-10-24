import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { leaveChallenge } from "@/app/challenge-actions";

// Leave a challenge — the web's leaveChallenge().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (!b || typeof b.id !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid challenge" }, 400);
  const result = await leaveChallenge(b.id);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
