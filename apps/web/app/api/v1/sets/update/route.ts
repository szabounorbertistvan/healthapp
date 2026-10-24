import type { UpdateSetV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { updateLoggedSet } from "@/app/client-actions-training";

// Fix a set already on record — the web's updateLoggedSet(): the same checks,
// PR flags recomputed over the lift's history, RLS keeping it to one's own sets.
export const dynamic = "force-dynamic";

const num = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
const orNull = (v: unknown) => (v === null || v === undefined ? null : num(v));

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<UpdateSetV1> | null;
  if (!b || typeof b.setId !== "string") return apiJson<WriteResultV1>({ ok: false, message: "invalid set" }, 400);
  const result = await updateLoggedSet(
    b.setId,
    {
      weight_kg: num(b.weightKg),
      reps: num(b.reps),
      rpe: orNull(b.rpe),
      rir: orNull(b.rir),
      notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim().slice(0, 500) : null,
      duration_seconds: orNull(b.durationSeconds),
    },
    typeof b.dayId === "string" ? b.dayId : null,
  );
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message, is_pr: result.is_pr });
});
