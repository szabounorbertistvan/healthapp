"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { ErrorReporter } from "@/components/error-reporter";

/**
 * The app's error boundary: anything that throws under a route segment lands
 * here instead of a blank screen. It reports itself to /admin/errors (the
 * store behind the panel's "Application errors" tile) and offers the two ways
 * out that always work — retry the segment, or go back to the start.
 *
 * The admin panel keeps its own, narrower copy at (admin)/error.tsx.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const e = t.common.errorBoundary;
  return (
    <div className="mx-auto mt-10 max-w-md rounded-3xl bg-surface p-6 text-center">
      <ErrorReporter error={error} />
      <p className="font-display text-lg font-bold tracking-tight">{e.title}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{e.body}</p>
      {error.digest ? (
        <p className="mt-3 font-mono text-[11px] text-ink-faint">
          {e.reference}: {error.digest}
        </p>
      ) : null}
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center rounded-2xl bg-accent px-4 font-display text-[13px] font-bold text-accent-fg hover:opacity-90"
        >
          {e.retry}
        </button>
        <Link href="/" className="inline-flex h-10 items-center rounded-2xl px-4 text-[13px] font-semibold text-ink-soft hover:text-ink">
          {e.home}
        </Link>
      </div>
    </div>
  );
}
