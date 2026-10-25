import type { ReportPreviewV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { getPlan } from "@/lib/plan";
import { CSV_KINDS, type CsvKind } from "@/lib/reports/csv-exports";
import { reportFileName } from "@/lib/reports/file-name";
import { loadProgressReportInputs, reportViewer } from "@/lib/reports/report-data";
import { buildProgressReport, parseReportPeriod } from "@/lib/reports/report-model";

// What a report would hold — the web's /reports preview: the same
// buildProgressReport() the PDF is made from, for the same period, so what it
// says is in the file is what is in the file. Built only for the PDF.
export const dynamic = "force-dynamic";

type ReportType = "progress" | CsvKind;
const TYPES: readonly ReportType[] = ["progress", ...CSV_KINDS];

export const GET = v1Route(async (request) => {
  const [{ t, locale }, viewer, plan] = await Promise.all([getI18n(), reportViewer(), getPlan()]);
  const r = t.clientApp.reports;
  if (!viewer) return apiJson<ReportPreviewV1>({ ok: false, code: "REPORT_SIGNED_OUT", message: r.errors.REPORT_SIGNED_OUT }, 401);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const type: ReportType = TYPES.includes(params.type as ReportType) ? (params.type as ReportType) : "progress";
  const parsed = parseReportPeriod(params, viewer.today);
  if (!parsed.ok) return apiJson<ReportPreviewV1>({ ok: false, code: parsed.code, message: r.errors[parsed.code] });
  const period = parsed.period;
  const lang = locale === "ro" ? "ro" : "en";
  const report = type === "progress" ? buildProgressReport(await loadProgressReportInputs(viewer, period, lang)) : null;
  const sections = report
    ? [
        { key: "training" as const, ok: report.training.available, extra: report.summary.training.current.workouts > 0 ? `${report.summary.training.current.workouts} ${r.pdf.workouts.toLowerCase()}` : null },
        { key: "body" as const, ok: report.body.available, extra: report.body.available ? `${report.body.rows.length}` : null },
        { key: "nutrition" as const, ok: report.nutrition.available, extra: report.nutrition.available ? fill(r.pdf.daysLoggedValue, { logged: report.nutrition.current.days_logged, tracked: report.nutrition.current.tracked_days }) : null },
        { key: "goals" as const, ok: report.goals.available, extra: report.goals.available ? String(report.goals.active.length) : null },
        { key: "fitness" as const, ok: report.fitness.available, extra: report.fitness.available ? `${report.fitness.score.score}/100` : null },
      ]
    : null;
  const periodQuery = period.preset === "custom" ? `from=${period.from}&to=${period.to}` : `range=${period.preset}`;
  const missing = report && report.nutrition.available ? report.nutrition.labelsMissing : null;
  return apiJson<ReportPreviewV1>({
    ok: true,
    from: period.from,
    to: period.to,
    days: period.days,
    sections,
    nothing: sections !== null && sections.every((s) => !s.ok),
    labels_missing: missing ? (missing === "failed" ? "failed" : "incomplete") : null,
    can_export: plan.e.reportExports,
    file: `${type === "progress" ? "progress.pdf" : `${type}.csv`}?${periodQuery}`,
    file_name: reportFileName(type, type === "progress" ? "pdf" : "csv", period),
  });
});
