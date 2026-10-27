import type { RoutineDetailV1, WriteResultV1 } from "@healthapp/api/v1";
import { canChangeVisibility, canCopyProgram, canShareProgram, estimateMinutes, sessionMinutes, validateProgram } from "@healthapp/shared";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { hasActiveCoach } from "@/lib/client-data";
import { getRoster } from "@/lib/data";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getRoutineAssignees, getRoutineDetail, getRoutineUsage } from "@/lib/routine-data";
import { toProgramShape } from "@/lib/routine-shape";
import { shareRoutine, updateRoutineDetails } from "@/app/routine-actions";

// One routine — the web's /routines/[id]: RLS decides whether it exists for the
// reader at all; the same rules say whether they may copy it, edit it, change
// who sees it, post it to the feed or (a coach) assign it. POST: details | share.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request, { userId: viewerId }) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [detail, coached] = await Promise.all([getRoutineDetail(id), hasActiveCoach()]);
  if (!detail) return apiError("not_found", 404);
  const { card, days } = detail;
  const viewer = { id: viewerId, has_active_coach: coached };
  const mayEditDetails = card.is_mine && (card.coach_id !== null || !coached);
  const [{ t }, clients, assignees, usage] = await Promise.all([
    getI18n(),
    card.coach_id === viewerId || card.is_mine ? getRoster().catch(() => []) : Promise.resolve([]),
    getRoutineAssignees(card.id),
    getRoutineUsage(card.id),
  ]);
  const r = t.clientApp.routines;
  const dayName = new Map(days.map((d) => [d.id, d.name]));
  const check = mayEditDetails ? validateProgram(toProgramShape(detail)) : null;
  return apiJson<RoutineDetailV1>({
    card,
    intensity_mode: detail.intensity_mode,
    session_minutes: sessionMinutes(days.map((d) => d.exercises)),
    may_copy: canCopyProgram(card, { id: viewerId, has_active_coach: coached }),
    // The builder edits the reader's own solo programs (getMySoloPrograms).
    may_edit: card.is_mine && card.coach_id === null && !coached,
    may_edit_details: mayEditDetails,
    may_publish: canChangeVisibility(card, viewer),
    may_share: canShareProgram(card),
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    assignees: assignees.map((a) => ({ program_id: a.program_id, client_name: a.client_name, draft: a.status === "draft" })),
    usage_line: usage && (usage.copies > 0 || usage.completed > 0 || usage.saves > 0)
      ? [
        usage.saves > 0 ? fill(r.savesCount, { count: usage.saves }) : null,
        usage.copies > 0 ? fill(r.copiesCount, { count: usage.copies }) : null,
        usage.users > 1 ? fill(r.peopleTraining, { count: usage.users }) : null,
        usage.completed > 0 ? fill(r.sessionsLogged, { count: usage.completed }) : null,
      ].filter(Boolean).join(" · ")
      : null,
    completeness: check
      ? [...check.errors, ...check.warnings].map((issue) => ({
        severity: issue.severity === "error" ? "error" as const : "warning" as const,
        text: r.issue[issue.code],
        day: issue.day_id ? dayName.get(issue.day_id) ?? null : null,
      }))
      : null,
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

export const POST = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  if (b?.op === "share") {
    const r = await shareRoutine(id);
    return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
  }
  if (b?.op === "details") {
    const r = await updateRoutineDetails({
      programId: id,
      name: str(b.name) ?? undefined,
      description: str(b.description),
      level: str(b.level),
      goal: str(b.goal),
      trainingStyle: str(b.trainingStyle),
      visibility: str(b.visibility) ?? undefined,
      weeks: typeof b.weeks === "number" ? b.weeks : undefined,
    });
    return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
  }
  return apiJson<WriteResultV1>({ ok: false, message: "invalid" }, 400);
});
