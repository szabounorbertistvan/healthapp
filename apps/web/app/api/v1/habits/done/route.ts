import type { HabitDoneV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { setHabitDone } from "@/app/client-actions-habits";

// A habit's tick for one day, as a state — the web's setHabitDone(), which the
// outbox may deliver twice: done twice is still done.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<HabitDoneV1> | null;
  if (!b || typeof b.habitId !== "string" || typeof b.day !== "string" || typeof b.done !== "boolean") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid habit" }, 400);
  }
  const result = await setHabitDone(b.habitId, b.day, b.done);
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
