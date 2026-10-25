import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { finishWorkoutImport } from "@/app/import-actions";

// After the last chunk: the PR flags of the lifts the import touched — the web's finishWorkoutImport().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { exerciseIds?: unknown } | null;
  const ids = Array.isArray(b?.exerciseIds) ? b.exerciseIds.filter((x): x is string => typeof x === "string") : [];
  const r = await finishWorkoutImport(ids);
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
