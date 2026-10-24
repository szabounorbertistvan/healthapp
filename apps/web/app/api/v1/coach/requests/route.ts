import type { CoachRequestV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getCoachRequests } from "@/lib/coach-profile-data";

// Coaching requests waiting for this coach's answer — the web's /requests (pending).
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const rows = await getCoachRequests("pending");
  return apiJson<CoachRequestV1[]>(
    rows.map((r) => ({
      id: r.id,
      client_name: r.client_name,
      service_name: r.service_name,
      message: r.message,
      goal: r.goal,
      created_at: r.created_at,
    })),
  );
});
