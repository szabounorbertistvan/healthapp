import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { ReportExport } from "@/components/report-export";
import { CSV_KINDS, type CsvKind } from "@/lib/reports/csv-exports";
import { reportFileName } from "@/lib/reports/file-name";
import { loadProgressReportInputs, reportViewer } from "@/lib/reports/report-data";
import { buildProgressReport, parseReportPeriod, REPORT_PRESETS, type ReportPeriod } from "@/lib/reports/report-model";
import { FIELD, LABEL, SMALL_BUTTON } from "@/lib/form-classes";

type ReportType = "progress" | CsvKind;
const TYPES: readonly ReportType[] = ["progress", ...CSV_KINDS];

/**
 * Reports & export: pick what, pick when, see what the period holds, then
 * download or share the file. State lives in the URL (type, range or from/to),
 * so every choice is a plain link or a GET form — a server render of the
 * person's own data, nothing to hydrate but the two buttons.
 *
 * The preview is the same buildProgressReport() the PDF is made from, for the
 * same period, so what it says is in the file is what is in the file. It is
 * built only for the PDF: a CSV is one table read on download, and reading the
 * whole progress report to preview it would load every section for nothing.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ t, locale }, raw, viewer] = await Promise.all([getI18n(), searchParams, reportViewer()]);
  const r = t.clientApp.reports;
  if (!viewer) return <EmptyState title={t.clientApp.today.notSignedInTitle} hint={t.clientApp.today.notSignedInHint} />;

  const typeRaw = Array.isArray(raw.type) ? raw.type[0] : raw.type;
  const type: ReportType = TYPES.includes(typeRaw as ReportType) ? (typeRaw as ReportType) : "progress";
  const parsed = parseReportPeriod(raw as Record<string, string | string[] | undefined>, viewer.today);
  const period: ReportPeriod | null = parsed.ok ? parsed.period : null;
  const custom = period?.preset === "custom" || (!parsed.ok && (raw.from !== undefined || raw.to !== undefined));

  const lang = locale === "ro" ? "ro" : "en";
  const report = period && type === "progress" ? buildProgressReport(await loadProgressReportInputs(viewer, period, lang)) : null;

  const query = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    q.set("type", over.type ?? type);
    if (over.range) q.set("range", over.range);
    else if (over.from && over.to) { q.set("from", over.from); q.set("to", over.to); }
    else if (period) {
      if (period.preset === "custom") { q.set("from", period.from); q.set("to", period.to); }
      else q.set("range", String(period.preset));
    }
    return q.toString();
  };
  const periodQuery = period
    ? period.preset === "custom" ? `from=${period.from}&to=${period.to}` : `range=${period.preset}`
    : "";
  const fileUrl = period ? `/api/reports/${type === "progress" ? "progress.pdf" : `${type}.csv`}?${periodQuery}` : null;
  const fileName = period ? reportFileName(type, type === "progress" ? "pdf" : "csv", period) : "";
  const df = new Intl.DateTimeFormat(lang === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const fmt = (d: string) => df.format(new Date(`${d}T00:00:00Z`));

  const sections = report
    ? [
        { label: r.pdf.training, ok: report.training.available, extra: report.summary.training.current.workouts > 0 ? `${report.summary.training.current.workouts} ${r.pdf.workouts.toLowerCase()}` : null },
        { label: r.pdf.body, ok: report.body.available, extra: report.body.available ? `${report.body.rows.length}` : null },
        { label: r.pdf.nutrition, ok: report.nutrition.available, extra: report.nutrition.available ? fill(r.pdf.daysLoggedValue, { logged: report.nutrition.current.days_logged, tracked: report.nutrition.current.tracked_days }) : null },
        { label: r.pdf.goals, ok: report.goals.available, extra: report.goals.available ? String(report.goals.active.length) : null },
        { label: r.pdf.fitness, ok: report.fitness.available, extra: report.fitness.available ? `${report.fitness.score.score}/100` : null },
      ]
    : [];
  const nothing = report !== null && sections.every((s) => !s.ok);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/progress" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink">
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.common.nav.progress}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{r.title}</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{r.intro}</p>

      <Card plain className="mt-5 space-y-5 sm:p-5">
        <fieldset>
          <legend className="text-[13px] font-semibold text-ink-soft">{r.typeLabel}</legend>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {TYPES.map((k) => (
              <li key={k}>
                <Link
                  href={`/reports?${query({ type: k })}`}
                  scroll={false}
                  aria-current={k === type ? "page" : undefined}
                  className={`block h-full rounded-2xl px-3.5 py-3 ${k === type ? "bg-accent-soft ring-1 ring-accent" : "bg-bg hover:bg-accent-soft/40"}`}
                >
                  <span className="block text-[13.5px] font-semibold">{r.types[k]}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-faint">{r.typeHints[k]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset>
          <legend className="text-[13px] font-semibold text-ink-soft">{r.periodLabel}</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REPORT_PRESETS.map((n) => {
              const on = !custom && period?.preset === n;
              return (
                <Link key={n} href={`/reports?${query({ range: String(n) })}`} scroll={false} aria-current={on ? "page" : undefined}
                  className={`h-9 rounded-full px-3.5 text-[12.5px] font-semibold leading-9 tabular-nums ${on ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"}`}>
                  {n === 365 ? r.periodYear : fill(r.periodDays, { days: n })}
                </Link>
              );
            })}
          </div>
          {/* a plain GET form: works without JavaScript, and the URL keeps the choice */}
          <form method="get" action="/reports" className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="type" value={type} />
            <label className={LABEL}>
              {r.from}
              <input type="date" name="from" required max={viewer.today} defaultValue={period?.preset === "custom" ? period.from : (typeof raw.from === "string" ? raw.from : "")} className={FIELD} />
            </label>
            <label className={LABEL}>
              {r.to}
              <input type="date" name="to" required max={viewer.today} defaultValue={period?.preset === "custom" ? period.to : (typeof raw.to === "string" ? raw.to : viewer.today)} className={FIELD} />
            </label>
            <button type="submit" className={`${SMALL_BUTTON} h-11`}>{r.applyDates}</button>
          </form>
          {!parsed.ok ? <p role="alert" className="mt-2 text-[12.5px] font-semibold text-risk">{r.errors[parsed.code]}</p> : null}
        </fieldset>
      </Card>

      {period ? (
        <Card plain className="mt-4 space-y-4 sm:p-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{r.previewTitle}</p>
            <p className="mt-1 font-display text-lg font-bold">{r.types[type]}</p>
            <p className="text-[12.5px] text-ink-soft">{fill(r.previewPeriod, { from: fmt(period.from), to: fmt(period.to), days: period.days })}</p>
          </div>
          {!report ? (
            <p className="text-[12.5px] leading-relaxed text-ink-soft">{r.previewCsv}</p>
          ) : nothing ? (
            <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-warn">{r.previewNoData}</p>
          ) : (
            <div>
              <p className="text-[12px] font-semibold text-ink-soft">{r.previewSections}</p>
              <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {sections.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-2 text-[12.5px]">
                    <span className={s.ok ? "font-semibold" : "text-ink-faint"}>{s.label}</span>
                    <span className="text-ink-faint tabular-nums">{s.ok ? (s.extra ?? "✓") : r.previewUnavailable}</span>
                  </li>
                ))}
              </ul>
              {report.nutrition.available && report.nutrition.labelsMissing ? (
                <p role="status" className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-[12px] font-semibold text-warn">
                  {report.nutrition.labelsMissing === "failed" ? r.pdf.labelsFailed : r.pdf.labelsIncomplete}
                </p>
              ) : null}
            </div>
          )}
          {fileUrl ? <ReportExport url={fileUrl} fileName={fileName} type={type === "progress" ? "application/pdf" : "text/csv"} /> : null}
          <p className="text-[11.5px] leading-relaxed text-ink-faint">{r.privacy}</p>
          {type !== "progress" ? <p className="text-[11.5px] leading-relaxed text-ink-faint">{r.csvNote}</p> : null}
        </Card>
      ) : null}
    </div>
  );
}
