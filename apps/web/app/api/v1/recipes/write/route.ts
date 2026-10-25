import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { createRecipe, deleteRecipe, logRecipeServings, updateRecipePreparation } from "@/app/recipe-actions";

// The recipe writes — the web's recipe-actions, named by `op`: create, log
// servings into the diary, change the preparation, delete. Each validates its own input.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.op !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid request" }, 400);
  const input = (b.input ?? {}) as never;
  let r: { ok: boolean; message?: string; errorCode?: string; id?: string };
  switch (b.op) {
    case "create": r = await createRecipe(input); break;
    case "log": r = await logRecipeServings(input); break;
    case "prep": r = await updateRecipePreparation(input); break;
    case "delete": r = await deleteRecipe(typeof b.id === "string" ? b.id : ""); break;
    default: return apiJson<WriteResultV1>({ ok: false, message: "unknown op" }, 400);
  }
  return apiJson<WriteResultV1 & { id?: string; errorCode?: string }>({ ok: r.ok, message: r.message, errorCode: r.errorCode, id: r.id });
});
