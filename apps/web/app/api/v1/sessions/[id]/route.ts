import type { FeedbackSessionV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getLocale } from "@/lib/i18n/server";
import { getMyWorkoutWithFeedback } from "@/lib/workout-feedback";

// One of the reader's own finished workouts, set by set, with what their coach
// wrote on it — the web's /workout/session/[id]. Reading it marks those
// comments read, as the page does. Someone else's session is a 404.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  const session = await getMyWorkoutWithFeedback(id, (await getLocale()) === "ro" ? "ro" : "en");
  if (!session) return apiError("not_found", 404);
  return apiJson<FeedbackSessionV1>(session);
});
