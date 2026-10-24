import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { archiveHabit } from "@/app/client-actions-habits";

// Remove a habit from the list — the web's archiveHabit(); its ticks stay in the history.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { habitId?: unknown } | null;
  if (!b || typeof b.habitId !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid habit" }, 400);
  const result = await archiveHabit(b.habitId);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
