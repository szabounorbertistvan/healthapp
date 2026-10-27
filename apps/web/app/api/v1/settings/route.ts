import type { SettingsV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { getMyCoachProfileStatus } from "@/lib/coach-profile-data";
import { getProfile } from "@/lib/data";
import { getMyGyms } from "@/lib/gym-data";
import { gymMapHref } from "@/lib/gym-map";
import { getMySocialPrivacy } from "@/lib/social-data";

// The app's Account screen: the same profile row /account and /settings edit,
// the social privacy and the home gym — /account's own reads.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [p, privacy, gyms, coachStatus] = await Promise.all([getProfile(), getMySocialPrivacy(), getMyGyms(), getMyCoachProfileStatus()]);
  if (!p) return apiError("not_found", 404);
  return apiJson<SettingsV1>({
    role: p.role,
    avatar_url: p.avatar_url,
    uploads: cloudinaryConfigured(),
    coach_status: coachStatus,
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
    privacy,
    gym: {
      home: gyms.home
        ? { id: gyms.home.id, name: gyms.home.name, city: gyms.home.city, address: gyms.home.address, map_url: gymMapHref(gyms.home) }
        : null,
      board: gyms.board,
    },
  });
});
