import type { WorkoutsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { daySummary } from "@/lib/api/workouts";
import { getMyNextWorkoutDayId, getMyProgramGroups, hasActiveCoach } from "@/lib/client-data";

// The app's Workout tab: every published program the person holds, as the
// web's /workout lists them (getMyProgramGroups), with the same "next" day.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [groups, nextDayId, coached] = await Promise.all([getMyProgramGroups(), getMyNextWorkoutDayId(), hasActiveCoach()]);
  return apiJson<WorkoutsV1>({
    programs: groups.map((g) => ({
      program_id: g.program_id,
      program_name: g.program_name,
      is_own: g.is_own,
      followed: g.followed,
      days: g.days.map(daySummary),
    })),
    next_day_id: nextDayId,
    has_coach: coached,
  });
});
