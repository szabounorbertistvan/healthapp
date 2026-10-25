import type { ProgressBodyV1 } from "@healthapp/api/v1";
import { compareMeasurements, progressWindows } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getMyMeasurements } from "@/lib/client-data";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { getMyPhotos } from "@/lib/photos-data";
import { getPlan, inHistory } from "@/lib/plan";
import { myToday } from "@/lib/my-today";

// The Body tab's two-dates card and progress photos — the web's
// /progress?tab=body: the same days, the same default pair (the first and last
// weigh-in of the last 30 days, else the last two ever), compareMeasurements()
// from packages/shared, and the plan's history window on both.
export const dynamic = "force-dynamic";

const MEASUREMENT_HISTORY = 500;

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const [plan, all, allPhotos, today] = await Promise.all([getPlan(), getMyMeasurements(MEASUREMENT_HISTORY), getMyPhotos(), myToday()]);
  const measurements = all.filter((m) => inHistory(plan, m.taken_on));
  const photos = allPhotos.filter((p) => inHistory(plan, p.date));
  const rows = measurements.map((m) => ({ day: m.taken_on, weight_kg: m.weight_kg, circumferences: m.circumferences }));
  const days = [...new Set(measurements.map((m) => m.taken_on))].sort();
  const windows = progressWindows(today, 30, days[0] ?? null);
  const inPeriod = days.filter((d) => d >= windows.current.start && d <= windows.current.end);
  const [defaultFrom, defaultTo] = inPeriod.length >= 2 ? [inPeriod[0]!, inPeriod.at(-1)!] : [days.at(-2) ?? null, days.at(-1) ?? null];
  const from = q.get("from") && days.includes(q.get("from")!) ? q.get("from")! : defaultFrom;
  const to = q.get("to") && days.includes(q.get("to")!) ? q.get("to")! : defaultTo;
  return apiJson<ProgressBodyV1>({
    days,
    from,
    to,
    comparison: from && to ? compareMeasurements(rows, from, to) : null,
    photos: {
      configured: cloudinaryConfigured(),
      compare: plan.e.photoCompare,
      items: photos,
      older_hidden_days: photos.length < allPhotos.length ? (plan.e.historyDays ?? 0) : null,
    },
  });
});
