import type { CoachSlotsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getBookingSlots } from "@/lib/booking-data";

// Free starts for one service over a few days — the web's booking page read
// (coach_booking_slots(): start / end times only, nothing about other people).
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const GET = v1Route(async (request) => {
  const q = new URL(request.url).searchParams;
  const service = q.get("service") ?? "";
  const from = q.get("from") ?? "";
  if (!UUID.test(service) || !DAY.test(from)) return apiJson<CoachSlotsV1>([]);
  return apiJson<CoachSlotsV1>(await getBookingSlots(service, from, Math.min(14, Math.max(1, Number(q.get("days")) || 7))));
});
