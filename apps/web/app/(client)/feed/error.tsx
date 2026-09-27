"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { ErrorReporter } from "@/components/error-reporter";
import { NavIcon } from "@/components/client-nav";
import { SOCIAL } from "@/lib/social-ui";

const RETRY = "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7";

/**
 * When the feed's read throws. Narrower than app/error.tsx: it stays inside
 * the feed column and the shell around it, reports itself to /admin/errors the
 * same way, and retries the way that actually re-reads — a refresh of the
 * server component inside the transition, then reset() to re-render the
 * segment. No digest, no stack: the reference lives in the admin panel.
 */
export default function FeedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const s = t.common.social;
  return (
    <div className={SOCIAL.column}>
      <ErrorReporter error={error} />
      <div role="alert" className="mt-6 rounded-2xl border border-line bg-surface px-6 py-10 text-center">
        <p className="font-display text-lg font-bold tracking-tight">{s.feedErrorTitle}</p>
        <p className="mt-1.5 text-[13.5px] text-ink-soft">{s.feedErrorBody}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          <NavIcon d={RETRY} className={`h-4 w-4 [stroke-width:2.2] ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} />
          {t.common.errorBoundary.retry}
        </button>
      </div>
    </div>
  );
}
