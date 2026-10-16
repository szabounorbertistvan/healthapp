// Reports and exports, delivered as files by this app.
//
//   GET /api/reports/progress.pdf        the progress report
//   GET /api/reports/<kind>.csv          workouts | exercise-progress | body | nutrition | goals
//   ?range=7|30|90|365  or  ?from=YYYY-MM-DD&to=YYYY-MM-DD   (local days)
//
// Whose data: the session's, and only the session's — there is no user id in
// the URL, and every read is filtered by the signed-in user and answered by
// RLS (lib/reports/report-data.ts). Signed out → 401, no file; a plan
// without reportExports → 403.
//
// The file is made on request and streamed back; it is never stored, never
// cached (no-store, private), never sent to another service. Errors come back
// as JSON { error, message } so the page can show the reason.
import { NextResponse } from "next/server";
import { getI18n } from "@/lib/i18n/server";
import { toCsv } from "@/lib/reports/csv";
import {
  bodyCsv, exerciseProgressCsv, goalsCsv, isCsvKind, nutritionCsv, workoutsCsv, type CsvKind, type CsvStrings,
} from "@/lib/reports/csv-exports";
import { ReportRenderError } from "@/lib/reports/pdf";
import {
  readFoods, readGoals, readMeasurements, readTraining, reportViewer, ReportTooLargeError,
} from "@/lib/reports/report-data";
import { parseReportPeriod, type ReportPeriod } from "@/lib/reports/report-model";
import { reportFileName } from "@/lib/reports/file-name";
import { NO_STORE, progressPdfResponse, reportFail as fail } from "@/lib/reports/respond";
import { getPlan } from "@/lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Target = { kind: "progress"; format: "pdf" } | { kind: CsvKind; format: "csv" };

function parseFile(file: string): Target | null {
  if (file === "progress.pdf") return { kind: "progress", format: "pdf" };
  const m = /^([a-z-]+)\.csv$/.exec(file);
  if (m && isCsvKind(m[1])) return { kind: m[1], format: "csv" };
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const i18n = await getI18n();
  const { t, locale } = i18n;
  const r = t.clientApp.reports;
  const target = parseFile((await params).file);
  if (!target) return fail(404, "REPORT_KIND", r.errors.REPORT_KIND);

  const viewer = await reportViewer();
  if (!viewer) return fail(401, "REPORT_SIGNED_OUT", r.errors.REPORT_SIGNED_OUT);
  // Premium (ENTITLEMENTS.reportExports). Open to everyone while the paywall
  // is off. The GDPR data export under Account is a different door and free.
  if (!(await getPlan()).e.reportExports) return fail(403, "REPORT_PLAN", r.errors.REPORT_PLAN);

  const url = new URL(request.url);
  const parsed = parseReportPeriod(Object.fromEntries(url.searchParams), viewer.today);
  if (!parsed.ok) return fail(400, parsed.code, r.errors[parsed.code]);
  const period: ReportPeriod = parsed.period;
  const lang = locale === "ro" ? "ro" : "en";

  try {
    if (target.format === "pdf") return await progressPdfResponse(viewer, period, i18n);

    const strings: CsvStrings = { ...r.csv, metrics: t.clientApp.goals.metric, measureKeys: t.clientApp.goals.measureKey };
    const units = viewer.units;
    const tz = viewer.timeZone;
    let table;
    switch (target.kind) {
      case "workouts":
      case "exercise-progress": {
        const training = await readTraining(viewer, period.from, period.to, lang);
        if (training.truncated) throw new ReportTooLargeError();
        table = target.kind === "workouts"
          ? workoutsCsv(training.sessions, period, strings, units, tz)
          : exerciseProgressCsv(training.sessions, period, strings, units, tz);
        break;
      }
      case "body":
        table = bodyCsv(await readMeasurements(viewer, period), period, strings, units, tz);
        break;
      case "nutrition":
        table = nutritionCsv(await readFoods(viewer, period), period, strings, tz);
        break;
      case "goals": {
        const goals = await readGoals(viewer);
        if (!goals) return fail(500, "REPORT_FAILED", r.errors.REPORT_FAILED);
        table = goalsCsv(goals.all, period, strings, units, tz);
        break;
      }
    }
    const csv = toCsv(table.headers, table.rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${reportFileName(target.kind, "csv", period)}"`,
      },
    });
  } catch (e) {
    if (e instanceof ReportTooLargeError) return fail(413, "REPORT_TOO_LARGE", r.errors.REPORT_TOO_LARGE);
    // the cause goes to the server log without any of the person's data
    console.error(`[reports] ${target.kind}.${target.format} failed: ${e instanceof ReportRenderError ? e.message : e instanceof Error ? e.message : String(e)}`);
    return fail(500, "REPORT_FAILED", r.errors.REPORT_FAILED);
  }
}
