import type { AppConfigV1 } from "@healthapp/api/v1";
import { apiJson } from "@/lib/api/v1";

// What every app build asks first, before signing in — so it carries no
// token and no one's data. Raising a minimum here (and deploying) makes older
// builds show "please update" instead of breaking on an /api/v1 shape they do
// not know. The Android app's builds start at 1000 (apps/mobile/app.json).
export const dynamic = "force-dynamic";

const CONFIG: AppConfigV1 = {
  min_build: { android: 1000, ios: 1 },
  store_url: {
    android: "https://play.google.com/store/apps/details?id=fit.voinic.app",
    ios: "https://www.voinic.fit/get-the-app",
  },
};

export async function GET(): Promise<Response> {
  return apiJson<AppConfigV1>(CONFIG);
}
