import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { copyRoutine } from "@/app/routine-actions";

// Copy a routine into the reader's own programs — the web's copyRoutine() for oneself (copy_program()).
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
  if (!b || typeof b.id !== "string") return apiJson<WriteResultV1 & { id?: string }>({ ok: false, message: "invalid routine" }, 400);
  const result = await copyRoutine({ sourceId: b.id, name: typeof b.name === "string" ? b.name : null });
  return apiJson<WriteResultV1 & { id?: string }>({ ok: result.ok, message: result.message, id: result.id });
});
