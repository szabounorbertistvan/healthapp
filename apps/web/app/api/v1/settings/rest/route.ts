import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { saveRestPrefs } from "@/app/rest-actions";
import { getProfile } from "@/lib/data";

// The rest timer's default and its lock-screen switch — the web's saveRestPrefs(),
// over the person's current prefs so the per-lift rests and the browser's
// notify switch stay as they are.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { default_seconds?: unknown; alert?: unknown } | null;
  if (!b || typeof b.default_seconds !== "number" || typeof b.alert !== "boolean") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid rest" }, 400);
  }
  const profile = await getProfile();
  if (!profile) return apiJson<WriteResultV1>({ ok: false, message: "not signed in" }, 401);
  const result = await saveRestPrefs({ ...profile.rest_prefs, default_seconds: b.default_seconds, alert: b.alert });
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
