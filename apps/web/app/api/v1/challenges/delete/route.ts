import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { deleteChallenge } from "@/app/challenge-actions";

// Delete your own challenge — the web's deleteChallenge(); only the creator may.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (!b || typeof b.id !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid challenge" }, 400);
  const result = await deleteChallenge(b.id);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
