import type { CoachDashboardV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getCoachRequests } from "@/lib/coach-profile-data";
import { whyText } from "@/lib/dashboard-why";
import { getCheckIns, getDashboard } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getPlan } from "@/lib/plan";

// The coach's priority list — the web's /dashboard: getDashboard() ranks by the
// live signal, at risk first, and the "why" is the same sentence the web shows.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [{ t }, rows, checkIns, requests, plan] = await Promise.all([
    getI18n(),
    getDashboard(),
    getCheckIns(),
    getCoachRequests("pending").catch(() => []),
    getPlan(),
  ]);
  return apiJson<CoachDashboardV1>({
    clients: rows.map((r) => ({
      client_id: r.client_id,
      name: r.full_name,
      signal: r.signal,
      overall: r.overall_pct,
      why: whyText(r, t.coachApp.dashboard),
      last_activity: r.last_activity,
      pending_checkin: r.pending_checkin,
      unread: r.unread_messages,
    })),
    checkins_pending: checkIns.length,
    requests_pending: requests.length,
    pro: plan.e.advancedAnalytics,
  });
});
