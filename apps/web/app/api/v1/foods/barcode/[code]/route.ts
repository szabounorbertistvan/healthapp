import type { BarcodeV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { foodItem } from "@/lib/api/food";
import { lookupBarcode } from "@/app/nutrition-actions";

// A scanned barcode — the web's lookupBarcode(): the cache first, then the
// barcode-lookup function. A miss is an answer; the app falls back to search.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const code = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const result = await lookupBarcode(code);
  return apiJson<BarcodeV1>(result.ok ? { ok: true, food: foodItem(result.food) } : { ok: false, reason: result.reason });
});
