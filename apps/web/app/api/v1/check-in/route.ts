import type { CheckInSubmitV1, CheckInV1, CodedResultV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { submitCheckIn } from "@/app/client-actions-body";
import { getMyCheckInQuestions } from "@/lib/check-in-questions";
import { getMyCheckInState, hasActiveCoach } from "@/lib/client-data";
import { getProfile } from "@/lib/data";

// The weekly check-in: this week's state and the coach's own questions (GET),
// and the submission (POST) — getMyCheckInState / submitCheckIn, as on /check-in.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [state, questions, coached, profile] = await Promise.all([
    getMyCheckInState(), getMyCheckInQuestions(), hasActiveCoach(), getProfile(),
  ]);
  if (!profile) return apiError("not_found", 404);
  return apiJson<CheckInV1>({
    week_start: state.week_start,
    submitted: state.submitted,
    has_coach: coached,
    last: state.last,
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, kind: q.kind })),
    weight_unit: profile.weight_unit,
  });
});

const scale = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<CheckInSubmitV1> | null;
  const scores = b ? [b.sleep, b.energy, b.stress, b.hunger, b.recovery].map(scale) : [null];
  if (!b || scores.some((s) => s === null)) return apiJson<CodedResultV1>({ ok: false, message: "invalid check-in" }, 400);
  const [sleep, energy, stress, hunger, recovery] = scores as number[];
  const result = await submitCheckIn({
    weightKg: typeof b.weightKg === "number" && Number.isFinite(b.weightKg) && b.weightKg > 0 ? b.weightKg : null,
    sleep: sleep!, energy: energy!, stress: stress!, hunger: hunger!, recovery: recovery!,
    note: typeof b.note === "string" ? b.note : "",
    answers: Array.isArray(b.answers) ? b.answers : [],
  });
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
