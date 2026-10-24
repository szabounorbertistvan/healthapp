import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { saveEmailPref } from "@/app/email-actions";

// One email switch — the web's saveEmailPref(category, on); the push switches in the same column stay.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { category?: unknown; on?: unknown } | null;
  if (!b || typeof b.category !== "string" || typeof b.on !== "boolean") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid switch" }, 400);
  }
  const result = await saveEmailPref(b.category, b.on);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
