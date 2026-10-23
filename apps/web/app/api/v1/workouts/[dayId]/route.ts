import type { WorkoutDayV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { workoutDay } from "@/lib/api/workouts";
import { getWorkoutDay } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { getPreviousForDay } from "@/lib/exercise-analytics-data";

// One training day for the app's logger — what /workout/[dayId]/log renders:
// the prescription, today's sets, and last time's sets per lift. The app keeps
// this answer on the phone, so the logger opens with no signal.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const dayId = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [day, profile] = await Promise.all([getWorkoutDay(dayId), getProfile()]);
  if (!day || !profile) return apiError("not_found", 404);
  const previous = await getPreviousForDay(day);
  return apiJson<WorkoutDayV1>(workoutDay(day, previous, profile));
});
