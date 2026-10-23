import type { PushDeviceV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { liveUser } from "@/lib/supabase/server";

// The phone registers its Expo push token (register_push_device, 20261208100000):
// a token belongs to whoever signed in on that phone last.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<PushDeviceV1> | null;
  if (!b || typeof b.token !== "string" || (b.platform !== "android" && b.platform !== "ios")) {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid device" }, 400);
  }
  const live = await liveUser();
  if (!live) return apiJson<WriteResultV1>({ ok: false, message: "not signed in" }, 401);
  const { error } = await live.supabase.rpc("register_push_device", {
    p_token: b.token, p_platform: b.platform, p_build: typeof b.build === "string" ? b.build : null,
  });
  return apiJson<WriteResultV1>(error ? { ok: false, message: error.message } : { ok: true });
});
