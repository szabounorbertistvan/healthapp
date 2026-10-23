import type { MeasurementV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { addMeasurement } from "@/app/client-actions-body";

// A weigh-in and/or waist — the web's addMeasurement(), metric as stored.
export const dynamic = "force-dynamic";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<MeasurementV1> | null;
  if (!b) return apiJson<WriteResultV1>({ ok: false, message: "invalid measurement" }, 400);
  const result = await addMeasurement({
    weightKg: num(b.weightKg),
    waistCm: num(b.waistCm),
    takenOn: typeof b.takenOn === "string" ? b.takenOn : undefined,
  });
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
