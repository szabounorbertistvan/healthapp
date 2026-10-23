import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { deleteFoodLog } from "@/app/client-actions-food";

// Remove one diary entry — the web's deleteFoodLog(); RLS keeps it to the person's own rows.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (!b || typeof b.id !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid id" }, 400);
  const result = await deleteFoodLog(b.id);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
