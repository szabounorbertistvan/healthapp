import type { WorkoutsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { daySummary, sessionCard } from "@/lib/api/workouts";
import { getMyNextWorkoutDayId, getMyProgramGroups, getMySessions, hasActiveCoach } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { getPlan, inHistory } from "@/lib/plan";

// The app's Workout tab: every published program the person holds, as the
// web's /workout lists them (getMyProgramGroups), with the same "next" day,
// the same history (inside the plan's window) and the same athlete per card.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [{ locale }, groups, nextDayId, coached, allSessions, profile, plan] = await Promise.all([
    getI18n(), getMyProgramGroups(), getMyNextWorkoutDayId(), hasActiveCoach(), getMySessions(), getProfile(), getPlan(),
  ]);
  const sessions = allSessions.filter((s) => inHistory(plan, s.at));
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
    sex: profile?.sex ?? null,
    sessions: sessions.map((s) => ({ ...sessionCard(s), ago: timeAgo(s.at, locale) })),
    history_capped: sessions.length < allSessions.length,
  });
});
