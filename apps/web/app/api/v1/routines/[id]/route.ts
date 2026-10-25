import type { RoutineDetailV1 } from "@healthapp/api/v1";
import { canCopyProgram, estimateMinutes, sessionMinutes } from "@healthapp/shared";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { hasActiveCoach } from "@/lib/client-data";
import { getRoutineDetail } from "@/lib/routine-data";

// One routine — the web's /routines/[id]: RLS decides whether it exists for the
// reader at all; the same rules say whether they may copy it or edit it.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request, { userId: viewerId }) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [detail, coached] = await Promise.all([getRoutineDetail(id), hasActiveCoach()]);
  if (!detail) return apiError("not_found", 404);
  const { card, days } = detail;
  return apiJson<RoutineDetailV1>({
    card,
    intensity_mode: detail.intensity_mode,
    session_minutes: sessionMinutes(days.map((d) => d.exercises)),
    may_copy: canCopyProgram(card, { id: viewerId, has_active_coach: coached }),
    // The builder edits the reader's own solo programs (getMySoloPrograms).
    may_edit: card.is_mine && card.coach_id === null && !coached,
    days: days.map((d) => ({
      id: d.id,
      name: d.name,
      minutes: estimateMinutes(d.exercises),
      exercises: d.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        circuit: e.circuit,
        sets: e.target_sets,
        reps: e.target_reps,
        measure: e.measure === "time" ? "time" : "reps",
        rpe: e.target_rpe,
        weight_kg: e.target_weight_kg,
        rest_seconds: e.rest_seconds,
        set_type: e.set_type,
        equipment: e.equipment,
      })),
    })),
  });
});
