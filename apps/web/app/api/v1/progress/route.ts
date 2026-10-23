import type { ProgressV1 } from "@healthapp/api/v1";
import { apiError, apiJson, v1Route } from "@/lib/api/v1";
import { getMyMeasurements, getMyPrs } from "@/lib/client-data";
import { getProfile } from "@/lib/data";

// The app's Progress tab: recent weigh-ins and waist, and the best lifts —
// the same reads /progress starts from.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [profile, measurements, prs] = await Promise.all([getProfile(), getMyMeasurements(30), getMyPrs()]);
  if (!profile) return apiError("not_found", 404);
  return apiJson<ProgressV1>({
    weight_unit: profile.weight_unit,
    length_unit: profile.length_unit,
    measurements: measurements.map((m) => ({ taken_on: m.taken_on, weight_kg: m.weight_kg, waist_cm: m.waist_cm })),
    prs: prs.map((p) => ({ exercise: p.exercise, best_kg: p.best, at: p.at })),
  });
});
