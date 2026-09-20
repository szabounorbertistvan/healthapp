"use client";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * A failed admin RPC lands here rather than as a blank page. The message is
 * generic on purpose: PostgREST errors can name tables and columns, and the
 * console has the detail an admin developer needs.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);
  return (
    <div className="glass mx-auto mt-10 max-w-md rounded-3xl p-6 text-center">
      <p className="font-semibold">{t.admin.common.loadError}</p>
      {error.digest ? <p className="mt-1 font-mono text-[11px] text-ink-faint">{error.digest}</p> : null}
      <button type="button" onClick={reset} className="mt-4 inline-flex h-9 items-center rounded-xl bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90">
        {t.admin.common.retry}
      </button>
    </div>
  );
}
