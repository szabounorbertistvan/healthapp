// The HTTP side of a report, shared by the two routes that hand one out:
// /api/reports/[file] (the signed-in person's own) and
// /api/clients/[id]/report (a client's progress PDF, for their coach).
// Same headers, same fonts, same error shape — only whose rows differ, and
// that is the ReportViewer the route passes in.
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { getI18n } from "../i18n/server";
import { reportFileName } from "./file-name";
import { renderReportPdf, type PdfFonts } from "./pdf";
import { loadProgressReportInputs, type ReportViewer } from "./report-data";
import { buildProgressReport, type ReportPeriod } from "./report-model";

/** Never stored, never cached, never indexed: a report is one person's health data. */
export const NO_STORE = {
  "Cache-Control": "no-store, private, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Cross-Origin-Resource-Policy": "same-origin",
};

let fontCache: PdfFonts | null = null;
/** The embedded fonts (lib/reports/fonts — DejaVu Sans Condensed, see LICENSE-DejaVu.txt), read once per server instance. */
function reportFonts(): PdfFonts {
  if (!fontCache) {
    const dir = path.join(process.cwd(), "lib", "reports", "fonts");
    fontCache = {
      regular: new Uint8Array(readFileSync(path.join(dir, "DejaVuSansCondensed.ttf"))),
      bold: new Uint8Array(readFileSync(path.join(dir, "DejaVuSansCondensed-Bold.ttf"))),
    };
  }
  return fontCache;
}

/** Errors come back as JSON { error, message } so the page can show the reason. */
export function reportFail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

/** The progress report for `viewer.userId` over `period`, as a PDF download. Throws on a failed read or render. */
export async function progressPdfResponse(
  viewer: ReportViewer,
  period: ReportPeriod,
  { t, locale }: Awaited<ReturnType<typeof getI18n>>,
): Promise<NextResponse> {
  const lang = locale === "ro" ? "ro" : "en";
  const inputs = await loadProgressReportInputs(viewer, period, lang);
  const bytes = await renderReportPdf(buildProgressReport(inputs), {
    strings: t.clientApp.reports,
    goalMetricLabels: t.clientApp.goals.metric,
    measureKeyLabels: t.clientApp.goals.measureKey,
    perWeekLabel: t.clientApp.goals.perWeek,
    locale: lang,
    owner: viewer.owner,
    generatedAt: new Date(),
    units: viewer.units,
    fonts: reportFonts(),
  });
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportFileName("progress", "pdf", period)}"`,
      "Content-Length": String(bytes.length),
    },
  });
}
