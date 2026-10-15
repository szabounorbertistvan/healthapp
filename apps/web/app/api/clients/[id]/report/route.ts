// A client's progress report, for their coach.
//
//   GET /api/clients/<client id>/report       the progress PDF
//   ?range=7|30|90|365  or  ?from=YYYY-MM-DD&to=YYYY-MM-DD   (the client's local days)
//
// The same file the client downloads from /api/reports/progress.pdf, built by
// the same code (lib/reports/respond.ts) over the client's rows on the client's
// calendar, in the coach's units. Read-only: nothing is written or stored.
//
// Who may ask: a signed-in coach on the Coach Pro analytics plan (the client
// page's own gate, plan.e.advancedAnalytics) whose ACTIVE roster holds this
// client — the same check the client page 404s on. Anyone else gets 404, so
// the URL does not even confirm the id exists. RLS answers every read on top
// (is_active_coach_of in the coach read policies and in
// client_food_daily_totals), so a relationship that ends mid-request yields
// an empty report, never more.
import { NextResponse } from "next/server";
import { displayName } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { getPlan } from "@/lib/plan";
import { ReportRenderError } from "@/lib/reports/pdf";
import { clientReportViewer, ReportTooLargeError } from "@/lib/reports/report-data";
import { parseReportPeriod } from "@/lib/reports/report-model";
import { progressPdfResponse, reportFail as fail } from "@/lib/reports/respond";
import { liveUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const i18n = await getI18n();
  const r = i18n.t.clientApp.reports;
  const { id } = await params;

  const live = await liveUser();
  if (!live) return fail(401, "REPORT_SIGNED_OUT", r.errors.REPORT_SIGNED_OUT);
  if (!UUID.test(id)) return fail(404, "REPORT_KIND", r.errors.REPORT_KIND);

  const [plan, link] = await Promise.all([
    getPlan(),
    // coach_id filtered here, not left to RLS: tc_admin_read opens the table to an admin (see getClients)
    live.supabase
      .from("trainer_clients")
      .select("client:users!trainer_clients_client_id_fkey(full_name, username)")
      .eq("coach_id", live.userId)
      .eq("client_id", id)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (link.error) {
    console.error(`[reports] coach report roster check: ${link.error.message}`);
    return fail(500, "REPORT_FAILED", r.errors.REPORT_FAILED);
  }
  if (!link.data || !plan.e.advancedAnalytics) return fail(404, "REPORT_KIND", r.errors.REPORT_KIND);
  const client = link.data.client as unknown as { full_name: string | null; username: string | null } | null;

  // the name the client goes by in the app (displayName: the username, never an e-mail)
  const viewer = await clientReportViewer(id, displayName(client ? { username: client.username, full_name: client.full_name ?? "" } : null) || "—");
  if (!viewer) return fail(401, "REPORT_SIGNED_OUT", r.errors.REPORT_SIGNED_OUT);

  const parsed = parseReportPeriod(Object.fromEntries(new URL(request.url).searchParams), viewer.today);
  if (!parsed.ok) return fail(400, parsed.code, r.errors[parsed.code]);

  try {
    return await progressPdfResponse(viewer, parsed.period, i18n);
  } catch (e) {
    if (e instanceof ReportTooLargeError) return fail(413, "REPORT_TOO_LARGE", r.errors.REPORT_TOO_LARGE);
    // the cause goes to the server log without any of the client's data
    console.error(`[reports] coach progress.pdf failed: ${e instanceof ReportRenderError ? e.message : e instanceof Error ? e.message : String(e)}`);
    return fail(500, "REPORT_FAILED", r.errors.REPORT_FAILED);
  }
}
