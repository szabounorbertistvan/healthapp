"use client";
import { useEffect, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { canShareReport, fetchReport, saveReport, shareReport } from "@/lib/reports/deliver";
import { BUTTON, SMALL_BUTTON } from "@/lib/form-classes";

/**
 * Download / Share for one report file. The file is made by the route handler
 * from the signed-in person's own data (app/api/reports/[file]); this only
 * fetches it and hands it to the device.
 *
 * Share appears only where the browser can share files (feature detection after
 * mount, never assumed); Download always works, and a plain link to the same
 * URL is offered as the last resort for a browser that blocks the scripted
 * download. Errors from the server arrive with a message and are shown as is.
 */
export function ReportExport({ url, fileName, type }: { url: string; fileName: string; type: string }) {
  const { t } = useI18n();
  const r = t.clientApp.reports;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(canShareReport(fileName, type));
  }, [fileName, type]);

  function run(mode: "download" | "share") {
    setError(null);
    setNote(null);
    start(async () => {
      const got = await fetchReport(url, fileName);
      if (!got.ok) {
        setError(got.message ?? (got.error in r.errors ? r.errors[got.error as keyof typeof r.errors] : r.errors.REPORT_FAILED));
        return;
      }
      if (mode === "share") {
        const shared = await shareReport(got.blob, got.fileName, r.pdf.title);
        if (shared === "shared" || shared === "cancelled") return;
        // no share sheet after all, or it failed: fall back to saving the file
      }
      setNote(saveReport(got.blob, got.fileName) ? r.done : r.openInstead);
    });
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => run("download")} disabled={pending} className={BUTTON}>
          {pending ? r.downloading : r.download}
        </button>
        {canShare ? (
          <button type="button" onClick={() => run("share")} disabled={pending} className={SMALL_BUTTON} title={r.shareHint}>
            {r.share}
          </button>
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {error ? <p className="text-[12.5px] font-semibold text-risk">{error}</p> : null}
        {note ? <p className="text-[12.5px] text-ink-soft">{note}</p> : null}
      </div>
      <a href={url} className="inline-block text-[12px] font-semibold text-ink-faint underline-offset-2 hover:text-ink hover:underline" rel="noopener">
        {r.openInstead}
      </a>
    </div>
  );
}
