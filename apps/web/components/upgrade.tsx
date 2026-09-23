"use client";
import Link from "next/link";
import { NavIcon } from "./client-nav";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import type { Upgrade } from "@/lib/plan-client";

export type PlanFeature =
  | "history" | "charts" | "prs" | "fitnessTrend" | "photoCompare" | "share"
  | "barcode" | "favorites" | "customExercises" | "ownPrograms" | "videos"
  | "analytics" | "clientScore" | "programCopy" | "ingredientPlans";

const LOCK = "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2";

/**
 * What a gated feature shows instead of itself: what it is, which plan has
 * it, and the way there. Never a dead end and never a scold — the free thing
 * next to it keeps working.
 *
 * `card` stands alone as a surface; the default is a panel for inside a card
 * that is already there (the history list, the PR list, a dialog).
 */
export function UpgradeHint({
  feature,
  upgrade,
  values = {},
  card = false,
  className = "",
}: {
  feature: PlanFeature;
  upgrade: Upgrade;
  values?: Record<string, string | number>;
  card?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const copy = t.common.plan.features[feature];
  const vars = { plan: upgrade.label, ...values };
  return (
    <div
      className={`flex items-start gap-3 ${card ? "rounded-3xl bg-surface px-5 py-[18px]" : "rounded-2xl bg-accent-soft/60 px-4 py-3.5"} ${className}`}
    >
      <NavIcon d={LOCK} className="mt-0.5 h-5 w-5 shrink-0 text-accent-ink" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">{fill(copy.title, vars)}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{fill(copy.hint, vars)}</p>
        <Link
          href={upgrade.href}
          className="mt-2.5 inline-flex h-8 items-center rounded-full bg-accent px-3.5 text-[12px] font-semibold text-accent-fg hover:opacity-90"
        >
          {t.common.plan.seePlans}
        </Link>
      </div>
    </div>
  );
}

/** A small "Premium" / "Coach Pro" tag beside a control the plan does not include. */
export function PlanTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-accent-ink">
      <NavIcon d={LOCK} className="h-3 w-3" />
      {label}
    </span>
  );
}
