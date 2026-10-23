import type { TodayV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getToday } from "@/lib/client-today";

// The app's Today screen: the same getToday() the web's /today renders, so the
// two show one adherence number, one streak and one "next workout".
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const today = await getToday();
  if (!today) return apiError("not_found", 404);
  const next = today.next_workout;
  return apiJson<TodayV1>({
    display_name: today.full_name,
    has_coach: today.has_coach,
    adherence: {
      overall: today.adherence.overall,
      workout: today.adherence.workout,
      nutrition: today.adherence.nutrition,
      habits: today.adherence.habits,
      checkin: today.adherence.checkin,
      signal: today.adherence.signal,
    },
    streak_days: today.streak_days,
    sessions: { done: today.sessions_done, planned: today.sessions_planned },
    next_workout: next
      ? {
          day_id: next.day_id,
          day_name: next.day_name,
          program_name: next.program_name,
          exercise_count: next.exercises.length,
          completed: next.completed,
        }
      : null,
    nutrition: {
      plan_name: today.nutrition.plan_name,
      target: today.nutrition.target,
      totals: today.nutrition.totals,
    },
    habits: today.habits.map((h) => ({
      id: h.id,
      name: h.name,
      done_today: h.done_today,
      done_this_week: h.done_this_week,
      target_per_week: h.target_per_week,
    })),
    check_in: { week_start: today.check_in.week_start, submitted: today.check_in.submitted },
  });
});
