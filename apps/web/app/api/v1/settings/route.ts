import type { SettingsV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getProfile } from "@/lib/data";

// The app's Account screen: the same profile row /account and /settings edit.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const p = await getProfile();
  if (!p) return apiError("not_found", 404);
  return apiJson<SettingsV1>({
    role: p.role,
    account: {
      fullName: p.full_name,
      username: p.username ?? "",
      city: p.city ?? "",
      bio: p.bio ?? "",
      timezone: p.timezone,
      checkInWeekday: p.check_in_weekday,
      leaderboardVisibility: p.leaderboard_visibility,
      weightUnit: p.weight_unit,
      lengthUnit: p.length_unit,
    },
    rest: { default_seconds: p.rest_prefs.default_seconds, alert: p.rest_prefs.alert },
    email: p.email_prefs,
  });
});
