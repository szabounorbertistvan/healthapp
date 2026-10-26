import type { CoachRequestV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getCoachRequests } from "@/lib/coach-profile-data";
import type { CoachingRequestStatus } from "@/lib/coach-profile";

// The coach's contact requests — the web's /requests, one tab at a time
// (?tab=pending | accepted | coaching | declined | cancelled | all; pending
// when absent, which is what the inbox reads). "coaching" = accepted and
// started; "accepted" = accepted, not started yet, exactly as on the web.
export const dynamic = "force-dynamic";

const TABS = ["pending", "accepted", "coaching", "declined", "cancelled", "all"] as const;

export const GET = v1Route(async (request) => {
  const raw = new URL(request.url).searchParams.get("tab") ?? "";
  const tab = (TABS as readonly string[]).includes(raw) ? (raw as (typeof TABS)[number]) : "pending";
  const all = await getCoachRequests(tab === "all" ? null : tab === "coaching" ? "accepted" : (tab as CoachingRequestStatus));
  const rows = tab === "coaching" ? all.filter((r) => r.started) : tab === "accepted" ? all.filter((r) => !r.started) : all;
  return apiJson<CoachRequestV1[]>(
    rows.map((r) => ({
      id: r.id,
      client_name: r.client_name,
      service_name: r.service_name,
      message: r.message,
      goal: r.goal,
      created_at: r.created_at,
      status: r.status,
      client_id: r.client_id,
      client_avatar: r.client_avatar,
      preferred_format: r.preferred_format,
      gym_name: r.gym_name,
      started: r.started,
      relationship_status: r.relationship_status ?? null,
    })),
  );
});
