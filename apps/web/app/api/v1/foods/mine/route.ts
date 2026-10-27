import type { MyFoodV1, MyFoodWriteV1, NewFoodV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { foodItem } from "@/lib/api/food";
import { createCustomFood, deleteCustomFood, updateCustomFood } from "@/app/nutrition-actions";
import { getMyCustomFoods } from "@/lib/client-data";

// My foods — the web's /food/mine and NewFoodForm: the person's own custom
// foods (GET), and create / update / delete through the same actions, which
// check every number (a food the search does not have, or a barcode a scan missed).
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => apiJson<MyFoodV1[]>(await getMyCustomFoods()));

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { op?: unknown; id?: unknown; input?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id : "";
  if (b?.op === "delete") {
    const r = await deleteCustomFood(id);
    return apiJson<MyFoodWriteV1>({ ok: r.ok, message: r.message });
  }
  if (b?.op === "create" || b?.op === "update") {
    const input = (b.input ?? {}) as NewFoodV1;
    const r = b.op === "create" ? await createCustomFood(input) : await updateCustomFood(id, input);
    return apiJson<MyFoodWriteV1>(r.ok ? { ok: true, food: foodItem(r.food) } : { ok: false, message: r.message });
  }
  return apiJson<MyFoodWriteV1>({ ok: false, message: "invalid" }, 400);
});
