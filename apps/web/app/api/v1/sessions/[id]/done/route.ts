import type { WorkoutDoneV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getWorkoutReviewPrompt } from "@/lib/ai-review";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { getMyGyms, getRecentGyms, getSessionGym } from "@/lib/gym-data";
import { getI18n } from "@/lib/i18n/server";
import { getShareableSession } from "@/lib/social-data";
import { durationLabel } from "@/lib/share-card";
import { getMyStreak } from "@/lib/streak-data";

// "Workout completed!" for the app — the web's /workout/[dayId]/done reads:
// the finished session as it can be shared, what it did to the streak, where
// it happened (for the gym's tops), and the AI review prompt. ?day= is the
// program day the prompt is written about. Nothing is published here.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const url = new URL(request.url);
  const id = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
  const day = url.searchParams.get("day") ?? "";
  const { t, locale } = await getI18n();
  const [session, streak, gyms, recent, current, prompt] = await Promise.all([
    getShareableSession(id), getMyStreak(), getMyGyms(), getRecentGyms(), getSessionGym(id),
    day ? getWorkoutReviewPrompt(id, day, locale, t).catch(() => null) : Promise.resolve(null),
  ]);
  if (!session) return apiError("not_found", 404);
  const milestone = streak && streak.status.milestone !== null
    ? streak.milestones.find((m) => m.milestone === streak.status.milestone && m.current) ?? null : null;
  return apiJson<WorkoutDoneV1>({
    session,
    duration_label: durationLabel(session.duration_min),
    streak: streak ? {
      event: streak.status.event, current: streak.summary.current,
      milestone: milestone ? { milestone: milestone.milestone, streak_start: milestone.streak_start, shared: milestone.shared } : null,
    } : null,
    gym: { current, home: gyms.home ? { id: gyms.home.id, name: gyms.home.name, city: gyms.home.city } : null, recent },
    ai_prompt: prompt ?? null,
    uploads: cloudinaryConfigured(),
  });
});
