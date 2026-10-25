import type { StreakV1 } from "@healthapp/api/v1";
import { STREAK_SHARE_MIN } from "@healthapp/shared";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getMyStreak } from "@/lib/streak-data";

// The reader's streak — the web's /streak: derived from completed sessions.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const view = await getMyStreak();
  if (!view) return apiError("unauthorized", 401);
  return apiJson<StreakV1>({ ...view, share_min: STREAK_SHARE_MIN });
});
