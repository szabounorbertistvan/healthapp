"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

const ICON = "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01";

/**
 * "Getting started": the welcome cards and the setup steps again, from the
 * sidebar footer and the phone "More" sheet of both shells — next to Send
 * feedback, styled like it. Each page's own tour is its "Guided tour" button.
 *
 * Draws its own icon rather than NavIcon: client-nav.tsx renders this link,
 * and importing back from it would make the two modules a cycle.
 */
export function HelpLink({ sheet = false }: { sheet?: boolean }) {
  const { t } = useI18n();
  return (
    <Link
      href="/onboarding?intro=1"
      className={
        sheet
          ? "flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium text-ink-soft"
          : "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-ink-soft hover:bg-surface hover:text-ink"
      }
    >
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON} />
      </svg>
      <span className="flex-1">{t.onboarding.help.link}</span>
    </Link>
  );
}
