import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { setHomeGym } from "@/app/gym-actions";
import { getI18n } from "@/lib/i18n/server";

// Pick, change or drop the home gym and its board — the web's setHomeGym().
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { gymId?: unknown; board?: unknown } | null;
  if (!b || (b.gymId !== null && typeof b.gymId !== "string") || typeof b.board !== "boolean") {
    return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  }
  const [{ t }, result] = await Promise.all([getI18n(), setHomeGym(b.gymId as string | null, b.board)]);
  return apiJson<CodedResultV1>({
    ok: result.ok,
    errorCode: result.error,
    message: result.ok ? undefined : result.error ? t.gyms.errors[result.error] : t.gyms.errors.generic,
  });
});
