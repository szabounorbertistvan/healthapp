import type { ExerciseDetailV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getExerciseHistory, getExerciseProfile } from "@/lib/exercise-analytics-data";
import { exerciseImage } from "@/lib/exercise-images";
import { getLocale } from "@/lib/i18n/server";
import { getPlan, inHistory } from "@/lib/plan";

// One exercise — the web's /exercises/[id]: the library row (with this person's
// demo) and their own history of it (logged_sets is owner-only by policy); the
// plan gates the charts and the history window exactly as the page does.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const [profile, history, plan, locale] = await Promise.all([getExerciseProfile(id), getExerciseHistory(id), getPlan(), getLocale()]);
  if (!profile) return apiError("not_found", 404);
  const instructions = (locale === "ro" ? profile.instructions_ro : null) ?? profile.instructions_en;
  const facts = (["equipment", "level", "category", "mechanic", "force"] as const)
    .map((key) => ({ key, value: profile[key] ?? "" }))
    .filter((f) => f.value !== "");
  const shown = history.sessions.filter((s) => inHistory(plan, s.at));
  return apiJson<ExerciseDetailV1>({
    id: profile.id,
    name: (locale === "ro" ? profile.name_ro : null) ?? profile.name_en,
    primary_muscles: profile.primary_muscles,
    secondary_muscles: profile.secondary_muscles,
    facts,
    image: profile.images[0] ? exerciseImage(profile.images[0]) : null,
    video_url: profile.video_url,
    steps: (instructions ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    stats: history.stats,
    records: history.records,
    sessions: shown,
    history_cut: shown.length < history.sessions.length,
    charts_locked: !plan.e.progressCharts,
    truncated: history.truncated,
    today: history.today,
  });
});
