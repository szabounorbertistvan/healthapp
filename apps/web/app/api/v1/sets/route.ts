import type { LogSetV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { logSet } from "@/app/client-actions-training";

// One set from the app's outbox — through the web's own logSet(), which is why
// a replay is safe: its session and set keys are derived from the set itself,
// and a set already on record answers ok. The app may send a set long after it
// was done; `loggedAt` keeps it in the session it belongs to.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const body = (await request.json().catch(() => null)) as Partial<LogSetV1> | null;
  if (!body || typeof body.dayId !== "string" || typeof body.programExerciseId !== "string") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid set" }, 400);
  }
  const result = await logSet({
    dayId: body.dayId,
    dayName: String(body.dayName ?? ""),
    exerciseName: String(body.exerciseName ?? ""),
    exerciseId: typeof body.exerciseId === "string" ? body.exerciseId : null,
    programExerciseId: body.programExerciseId,
    setIndex: Number(body.setIndex),
    weightKg: Number(body.weightKg),
    reps: Number(body.reps),
    rpe: body.rpe == null ? null : Number(body.rpe),
    rir: body.rir == null ? null : Number(body.rir),
    notes: typeof body.notes === "string" ? body.notes : null,
    durationSeconds: body.durationSeconds == null ? null : Number(body.durationSeconds),
    loggedAt: typeof body.loggedAt === "string" ? body.loggedAt : undefined,
  });
  // A refusal is an answer (200, ok: false): the outbox stops retrying it.
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message, is_pr: result.is_pr });
});
