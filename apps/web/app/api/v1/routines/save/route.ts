import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { toggleRoutineSave } from "@/app/routine-actions";

// Bookmark a routine or take the bookmark off — the web's toggleRoutineSave(); `saved` is the state before.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown; saved?: unknown } | null;
  if (!b || typeof b.id !== "string" || typeof b.saved !== "boolean") {
    return apiJson<WriteResultV1 & { saved?: boolean }>({ ok: false, message: "invalid routine" }, 400);
  }
  const result = await toggleRoutineSave(b.id, b.saved);
  return apiJson<WriteResultV1 & { saved?: boolean }>({ ok: result.ok, message: result.message, saved: result.saved });
});
