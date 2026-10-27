import type { MeV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { displayName, getProfile } from "@/lib/data";
import { CONSENT_VERSION } from "@/lib/legal";

// Who the app is signed in as — the first call after sign-in.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const profile = await getProfile();
  if (!profile) return apiError("not_found", 404);
  return apiJson<MeV1>({
    id: profile.id,
    display_name: displayName(profile),
    username: profile.username,
    consent_ok: profile.consent_version === CONSENT_VERSION,
    role: profile.role,
    avatar_url: profile.avatar_url,
    weight_unit: profile.weight_unit,
  });
});
