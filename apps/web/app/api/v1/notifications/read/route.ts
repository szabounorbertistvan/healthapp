import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { markNotificationRead, markNotificationsRead } from "@/app/client-actions-notifications";

// One notification read ({ id }), or all of them (no id).
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const result = typeof b?.id === "string" ? await markNotificationRead(b.id) : await markNotificationsRead();
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
