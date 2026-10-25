import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { cancelBooking } from "@/app/booking-actions";

// Cancel a booking, with an optional reason — the web's cancelBooking(); cancel_booking() decides.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { id?: unknown; reason?: unknown } | null;
  if (!b || typeof b.id !== "string") return apiJson<CodedResultV1>({ ok: false, message: "invalid booking" }, 400);
  const result = await cancelBooking(b.id, typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null);
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
