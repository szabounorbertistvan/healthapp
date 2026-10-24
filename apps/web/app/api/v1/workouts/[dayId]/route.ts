import type { WorkoutDayV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { workoutDay } from "@/lib/api/workouts";
import { getWorkoutDay, getWorkoutDayHistory } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { getPreviousForDay } from "@/lib/exercise-analytics-data";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { getPlan, inHistory } from "@/lib/plan";

// One training day for the app — what /workout/[dayId] and its logger render:
// the prescription, today's sets, last time's sets per lift, and the day's
// history inside the plan's window. The app keeps this answer on the phone, so
// the day and the logger open with no signal.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const dayId = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [{ locale }, day, profile, allHistory, plan] = await Promise.all([
    getI18n(), getWorkoutDay(dayId), getProfile(), getWorkoutDayHistory(dayId), getPlan(),
  ]);
  if (!day || !profile) return apiError("not_found", 404);
  const previous = await getPreviousForDay(day);
  const history = allHistory.filter((s) => inHistory(plan, s.at));
  return apiJson<WorkoutDayV1>({
    ...workoutDay(day, previous, profile),
    type: day.type,
    sex: profile.sex ?? null,
    history: history.map((s) => ({
      id: s.id,
      at: s.at,
      ago: timeAgo(s.at, locale),
      sets: s.sets,
      volume_kg: s.volume_kg,
      prs: s.prs,
      load: s.load,
      exercises: s.exercises.map((e) => ({
        name: e.name,
        exercise_id: e.exercise_id ?? null,
        sets: e.sets.map((x) => ({
          id: x.id,
          set_index: x.set_index,
          weight_kg: x.weight_kg,
          reps: x.reps,
          duration_seconds: x.duration_seconds ?? null,
          rpe: x.rpe,
          rir: x.rir ?? null,
          notes: x.notes ?? null,
          is_pr: x.is_pr,
        })),
      })),
    })),
    history_capped: history.length < allHistory.length,
  });
});
