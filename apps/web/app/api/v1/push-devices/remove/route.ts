import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { liveUser } from "@/lib/supabase/server";

// Signing out on the phone: its token stops receiving this person's pushes.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!b || typeof b.token !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid" }, 400);
  const live = await liveUser();
  if (!live) return apiJson<WriteResultV1>({ ok: false, message: "not signed in" }, 401);
  const { error } = await live.supabase.rpc("unregister_push_device", { p_token: b.token });
  return apiJson<WriteResultV1>(error ? { ok: false, message: error.message } : { ok: true });
});
