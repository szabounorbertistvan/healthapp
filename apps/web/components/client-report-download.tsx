"use client";
import { useState } from "react";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { ReportExport } from "./report-export";
import { Card, Chip } from "./ui";

export type ClientReportOption = { days: number; url: string; fileName: string };

/**
 * The coach's copy of a client's progress PDF. The file is made by
 * /api/clients/[id]/report from the client's own rows, on the client's
 * calendar; the periods arrive resolved on the server (the client's today), so
 * this only picks one and hands it to the same Download / Share buttons the
 * client's own Reports page uses.
 */
export function ClientReportDownload({ name, options }: { name: string; options: ClientReportOption[] }) {
  const { t } = useI18n();
  const r = t.clientApp.reports;
  const [days, setDays] = useState(options[0]?.days ?? 30);
  const chosen = options.find((o) => o.days === days) ?? options[0];
  if (!chosen) return null;
  return (
    <section data-testid="client-report">
      <Card plain className="space-y-3 sm:p-5">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">{fill(r.coachTitle, { name })}</h2>
          <p className="mt-1 text-[12.5px] text-ink-faint">{r.coachHint}</p>
        </div>
        <fieldset>
          <legend className="sr-only">{r.periodLabel}</legend>
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => (
              <Chip key={o.days} on={o.days === days} onToggle={() => setDays(o.days)}>
                {o.days === 365 ? r.periodYear : fill(r.periodDays, { days: o.days })}
              </Chip>
            ))}
          </div>
        </fieldset>
        <ReportExport url={chosen.url} fileName={chosen.fileName} type="application/pdf" />
      </Card>
    </section>
  );
}
