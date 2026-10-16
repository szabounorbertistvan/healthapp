"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ADAPTIVE_WINDOW_DAYS, kgToDisplay, MIN_LOGGED_DAYS, MIN_WEIGH_INS, MIN_WEIGH_SPAN_DAYS, splitFromGrams,
  type AdaptiveEstimate, type AdaptiveGoal, type Macros,
} from "@healthapp/shared";
import { setMyNutritionTargets } from "@/app/client-actions-food";
import { settle } from "@/lib/settle-action";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { usePlan } from "@/lib/plan-client";
import { useUnits } from "@/lib/units/client";
import { PremiumSoon, UpgradeHint } from "./upgrade";

const GOALS: AdaptiveGoal[] = ["lose", "maintain", "gain"];

/**
 * Adaptive targets on the Trends view: maintenance as the person's own diary
 * and scale show it over four weeks (adaptiveEstimate), and a daily target for
 * each goal. "Set" writes the person's own targets through the same action as
 * the targets form, keeping their macro split; while a coach's plan is active
 * the coach's targets win, so the card only informs.
 */
export function AdaptiveTargets({
  estimate, target, planOwner,
}: {
  estimate: AdaptiveEstimate | null;
  /** The active target (zeros when none) — its split is kept on Set. */
  target: Macros;
  planOwner: "coach" | "self" | null;
}) {
  const { t } = useI18n();
  const m = t.clientApp.adaptiveTargets;
  const u = useUnits();
  const { e: plan, upgrade } = usePlan();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<AdaptiveGoal | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!plan.adaptiveTargets) return <UpgradeHint card feature="adaptiveTargets" upgrade={upgrade} />;
  if (!estimate) return null;

  function apply(goal: AdaptiveGoal, kcal: number) {
    setBusy(goal);
    setMessage(null);
    start(async () => {
      const result = await settle(() => setMyNutritionTargets({ kcal, split: splitFromGrams(target) }), t.common.actions.unreachable);
      setBusy(null);
      setMessage(result.ok ? { ok: true, text: fill(m.applied, { kcal }) } : { ok: false, text: result.message ?? m.couldNotApply });
      if (result.ok) router.refresh();
    });
  }

  const kg = (n: number) => `${kgToDisplay(n, u.weightUnit)} ${u.weightUnit}`;

  return (
    <section className="rounded-3xl glass p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold tracking-tight">
          {m.title}
          <PremiumSoon feature="adaptiveTargets" />
        </h2>
        <p className="text-[11.5px] text-ink-faint">{fill(m.window, { days: ADAPTIVE_WINDOW_DAYS })}</p>
      </div>

      {estimate.status === "not_enough" ? (
        <div className="mt-2 space-y-1.5 text-[13px] text-ink-soft">
          <p>{m.notEnough}</p>
          <ul className="space-y-0.5 tabular-nums text-ink-faint">
            <li>{fill(m.needDays, { have: estimate.logged_days, need: MIN_LOGGED_DAYS })}</li>
            <li>{fill(m.needWeighIns, { have: estimate.weigh_ins, need: MIN_WEIGH_INS, span: MIN_WEIGH_SPAN_DAYS })}</li>
          </ul>
        </div>
      ) : estimate.status === "implausible" ? (
        <p className="mt-2 text-[13px] text-ink-soft">{m.implausible}</p>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{m.how}</p>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-bg/60 p-3">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{m.maintenance}</dt>
              <dd className="mt-0.5 font-display text-xl font-bold tabular-nums text-accent-ink">{estimate.tdee}</dd>
            </div>
            <div className="rounded-2xl bg-bg/60 p-3">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{m.avgIntake}</dt>
              <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">{estimate.avg_intake}</dd>
            </div>
            <div className="rounded-2xl bg-bg/60 p-3">
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">{m.weekly}</dt>
              <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">
                {estimate.weekly_change_kg > 0 ? "+" : estimate.weekly_change_kg < 0 ? "−" : ""}{kg(Math.abs(estimate.weekly_change_kg))}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-faint">
            {fill(m.basis, { days: estimate.logged_days, weighIns: estimate.weigh_ins })}
          </p>

          <ul className="mt-4 grid gap-2 sm:grid-cols-3">
            {GOALS.map((goal) => {
              const kcal = estimate.targets[goal];
              const current = target.kcal > 0 && Math.abs(target.kcal - kcal) < 10;
              return (
                <li key={goal} className="flex items-center justify-between gap-2 rounded-2xl border border-line p-3">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold">{m.goals[goal]}</p>
                    <p className="font-display text-lg font-bold tabular-nums">{kcal} <span className="text-[12px] font-normal text-ink-faint">kcal</span></p>
                  </div>
                  {planOwner === "coach" ? null : current ? (
                    <span className="text-[11.5px] font-semibold text-accent-ink">{m.current}</span>
                  ) : (
                    <button type="button" disabled={pending} onClick={() => apply(goal, kcal)}
                      className="shrink-0 rounded-xl bg-accent px-3 py-1.5 text-[12px] font-bold text-accent-fg disabled:opacity-50">
                      {busy === goal ? m.setting : m.set}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {planOwner === "coach" ? <p className="mt-3 text-[12px] text-ink-faint">{m.coachOwns}</p> : null}
          {message ? (
            <p role="status" className={`mt-3 text-[12.5px] ${message.ok ? "text-accent-ink" : "text-risk"}`}>{message.text}</p>
          ) : null}
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{m.disclaimer}</p>
        </>
      )}
    </section>
  );
}
