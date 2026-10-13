"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { NavIcon } from "@/components/client-nav";
import { useOnboarding } from "./provider";

/**
 * "Finish setting up — 2 of 4 steps done": the way back to skipped or unfinished
 * setup steps, on Today (client) and the dashboard (coach). The server decides
 * whether it is shown (showSetupCard); Hide is remembered across devices.
 */
export function SetupCard({ done, total }: { done: number; total: number }) {
  const { t } = useI18n();
  const c = t.onboarding.card;
  const { mark } = useOnboarding();
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const width = Math.round((done / Math.max(total, 1)) * 100);

  return (
    <section
      aria-labelledby="setup-card-title"
      className="glass flex flex-col gap-3 rounded-3xl px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
    >
      <span aria-hidden className="hidden h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink sm:grid">
        <NavIcon d="M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0M19 3v4M17 5h4" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p id="setup-card-title" className="font-display text-[15px] font-bold tracking-tight">{c.title}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-faint">{fill(c.progress, { done, total })}</p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={fill(c.progress, { done, total })}
          className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-bg"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/onboarding"
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-accent px-4 font-display text-[13.5px] font-bold text-accent-fg hover:opacity-90"
        >
          {c.continue}
        </Link>
        <button
          type="button"
          aria-label={c.hideLabel}
          onClick={() => {
            setHidden(true);
            void mark("setup", "dismissed").then(() => router.refresh());
          }}
          className="inline-flex h-10 items-center justify-center rounded-2xl px-3.5 text-[13px] font-semibold text-ink-soft hover:bg-bg hover:text-ink"
        >
          {c.hide}
        </button>
      </div>
    </section>
  );
}
