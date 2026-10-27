import type { OnboardingV1, OnboardingWriteV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { displayName, getProfile } from "@/lib/data";
import { dishfinderRecipesUrl } from "@/lib/dishfinder";
import { getOnboardingState, getSetupSnapshot } from "@/lib/onboarding";
import { audienceOf } from "@/lib/onboarding-model";
import { CLIENT_GOALS, type ClientGoal } from "@/lib/coach-content";
import { chooseSoloFromSetup, markOnboarding, saveSetupGoal, saveSetupUnits } from "@/app/onboarding-actions";

// Onboarding for the app — what the web's /onboarding page and the cards on
// Today / the dashboard read (lib/onboarding.ts), and the same actions
// (app/onboarding-actions.ts). The model itself runs in the app, from
// @healthapp/shared/onboarding. "Later" on the recipes card is the device's
// own (a cookie on the web), so it is not here.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const profile = await getProfile();
  if (!profile) return apiError("unauthorized", 401);
  const [state, snapshot] = await Promise.all([getOnboardingState(), getSetupSnapshot(profile)]);
  return apiJson<OnboardingV1>({
    state,
    role: profile.role,
    audience: audienceOf(profile.role),
    facts: snapshot.facts,
    goal: snapshot.goal,
    coached: snapshot.coached,
    coach_profile_status: snapshot.coachProfileStatus,
    has_clients: snapshot.hasClients,
    name: displayName(profile),
    avatar_url: profile.avatar_url,
    uploads: cloudinaryConfigured(),
    weight_unit: profile.weight_unit,
    length_unit: profile.length_unit,
    timezone: profile.timezone,
    recipes_url: dishfinderRecipesUrl(),
  });
});

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (b?.op) {
    case "mark":
      return apiJson<OnboardingWriteV1>(await markOnboarding(str(b.key), str(b.mark) as Parameters<typeof markOnboarding>[1]));
    case "units":
      return apiJson<OnboardingWriteV1>(await saveSetupUnits({
        weightUnit: str(b.weightUnit) as "kg" | "lb",
        lengthUnit: str(b.lengthUnit) as "cm" | "in",
        timezone: str(b.timezone),
      }));
    case "goal": {
      const goal = str(b.goal);
      if (!(CLIENT_GOALS as readonly string[]).includes(goal)) return apiJson<OnboardingWriteV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
      return apiJson<OnboardingWriteV1>(await saveSetupGoal(goal as ClientGoal));
    }
    case "solo":
      return apiJson<OnboardingWriteV1>(await chooseSoloFromSetup());
    default:
      return apiJson<OnboardingWriteV1>({ ok: false, message: "invalid" }, 400);
  }
});
