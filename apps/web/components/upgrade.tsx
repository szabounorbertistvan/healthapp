"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startTrial } from "@/app/billing-actions";
import { settle } from "@/lib/settle-action";
import { NavIcon } from "./client-nav";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { usePlan, type Upgrade } from "@/lib/plan-client";
import type { Entitlements } from "@healthapp/shared";

export type PlanFeature =
  | "history" | "charts" | "prs" | "fitnessTrend" | "photoCompare" | "share"
  | "barcode" | "favorites" | "customExercises" | "ownPrograms" | "videos"
  | "analytics" | "clientScore" | "programCopy" | "ingredientPlans" | "progressionAdvice" | "adaptiveTargets"
  | "goals" | "reports" | "plateau";

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
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <TryTrialButton />
          <Link
            href={upgrade.href}
            className="inline-flex h-8 items-center rounded-full bg-accent px-3.5 text-[12px] font-semibold text-accent-fg hover:opacity-90"
          >
            {t.common.plan.seePlans}
          </Link>
        </div>
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

/** Entitlement keys that are on/off switches. */
type FlagKey = { [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never }[keyof Entitlements];

/**
 * "Premium · free for now": a feature everyone has while the paywall is off,
 * that this person's plan will not include once it is on. Renders nothing
 * when nothing will change for them (the paywall applies already, they pay,
 * or a Coach Pro covers them) — lib/plan.ts `later` decides. Tap or hover
 * explains; the label alone says it on a phone.
 */
export function PremiumSoon({ feature, className = "" }: { feature: FlagKey; className?: string }) {
  const { later, upgrade } = usePlan();
  const { t } = useI18n();
  if (!later || later[feature]) return null;
  const hint = fill(t.common.plan.soonHint, { plan: upgrade.label });
  return (
    <span title={hint} aria-label={hint}
      className={`inline-flex items-center whitespace-nowrap rounded-full bg-accent-soft/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent-ink ${className}`}>
      {fill(t.common.plan.soonTag, { plan: upgrade.label })}
    </span>
  );
}

/** The same notice for a limit (active goals): one line, only while the paywall is off and the free plan would cap it. */
export function PremiumSoonGoals({ className = "" }: { className?: string }) {
  const { later, upgrade, e } = usePlan();
  const { t } = useI18n();
  if (!later || later.maxActiveGoals === null || e.maxActiveGoals !== null) return null;
  return (
    <p className={`text-[12px] text-ink-faint ${className}`}>
      {fill(t.common.plan.soonGoals, { plan: upgrade.label, limit: later.maxActiveGoals })}
    </p>
  );
}

/**
 * "Try {plan} free for 30 days": the one trial per account, no card
 * (start_trial(), 20261129100000). Shown only while the database would accept
 * it — paywall on for this person, a free tier, never trialled — so with the
 * paywall off, or once used, it renders nothing.
 */
export function TryTrialButton({ className = "" }: { className?: string }) {
  const { trialAvailable, upgrade } = usePlan();
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!trialAvailable) return null;
  const m = t.common.plan;
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const result = await settle(() => startTrial(), t.common.actions.unreachable);
          if (!result.ok) {
            setError(result.errorCode === "TRIAL_USED" ? m.trialUsed : result.errorCode === "TRIAL_NOT_NEEDED" ? m.trialNotNeeded : m.trialFailed);
            return;
          }
          router.refresh();
        })}
        className="inline-flex h-8 items-center rounded-full border border-accent px-3.5 text-[12px] font-bold text-accent-ink hover:bg-accent-soft disabled:opacity-50"
      >
        {pending ? m.trialStarting : fill(m.tryTrial, { plan: upgrade.label })}
      </button>
      {error ? <span role="alert" className="text-[12px] font-semibold text-risk">{error}</span> : null}
    </span>
  );
}
