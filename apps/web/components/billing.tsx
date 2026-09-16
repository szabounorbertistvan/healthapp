"use client";
// Billing UI: trial banner, subscribe/manage panel, admin comp control.
// Prices shown are the MVP defaults from @healthapp/shared — Stripe's checkout
// page always displays the real amount, so a dashboard price change can't
// charge something different from what the user confirms.
import { useState, useTransition } from "react";
import {
  ENTITLEMENTS, PLAN_PRICES, TIER_LABEL, trialDaysLeft,
  type PaidTier, type PlanInterval, type Tier,
} from "@healthapp/shared";
import { adminSetTier, openBillingPortal, startCheckout } from "@/app/billing-actions";

/** Marks a plan line that is promised but not built yet. */
function Soon() {
  return (
    <span className="whitespace-nowrap rounded-full bg-ink/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]">
      soon
    </span>
  );
}

export function TrialBanner({ trialEndsAt, paid }: { trialEndsAt: string | null; paid: boolean }) {
  if (paid) return null;
  const days = trialDaysLeft(trialEndsAt);
  if (days === null) return null;
  return (
    <div className="mb-4 rounded-3xl bg-accent-soft px-5 py-[18px] text-[13.5px] leading-relaxed text-accent-ink">
      {days > 0 ? (
        <>
          <b>Free trial:</b> {days} day{days === 1 ? "" : "s"} left with full access — no card needed.
          Subscribe below to keep everything after it ends.
        </>
      ) : (
        <>
          <b>Your 30-day trial has ended.</b> You&apos;re on the Free plan — subscribe below to get
          full access back.
        </>
      )}
    </div>
  );
}

export function SubscribePanel({
  plan,
  currentTier,
  hasStripe,
  returnPath,
}: {
  plan: PaidTier;
  currentTier: Tier;
  hasStripe: boolean;
  returnPath: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const prices = PLAN_PRICES[plan];
  const e = ENTITLEMENTS[plan];
  const subscribed = currentTier === plan && hasStripe;

  function go(interval: PlanInterval) {
    setError(null);
    startTransition(async () => {
      const result = await startCheckout(plan, interval, returnPath);
      if (result.ok && result.url) window.location.assign(result.url);
      else setError(result.message ?? "Could not start checkout");
    });
  }

  function portal() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortal(returnPath);
      if (result.ok && result.url) window.location.assign(result.url);
      else setError(result.message ?? "Could not open billing portal");
    });
  }

  return (
    <div className="rounded-2xl border border-accent px-4 py-[18px]">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-lg font-bold tracking-tight">{TIER_LABEL[plan]}</p>
        {currentTier === plan ? (
          <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
            Current
          </span>
        ) : null}
      </div>
      {/* Only the client limit is enforced anywhere (create_invite raises
          CLIENT_LIMIT_REACHED); the other ENTITLEMENTS flags have no code
          behind them yet. This is the screen where someone hands over money,
          so what has not shipped says so rather than sitting under a tick. */}
      <ul className="mt-2.5 space-y-1 text-[13.5px] text-ink-soft">
        {plan === "coach_pro" ? (
          <>
            <li>Up to <b className="text-ink">{e.maxClients}</b> clients</li>
            <li className="text-ink-faint">Advanced analytics <Soon /></li>
          </>
        ) : (
          <>
            <li>✓ Everything in the free plan</li>
            <li className="text-ink-faint">Progress photos <Soon /></li>
          </>
        )}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {subscribed ? (
          <button
            onClick={portal}
            disabled={pending}
            className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Opening…" : "Manage billing"}
          </button>
        ) : (
          <>
            <button
              onClick={() => go("monthly")}
              disabled={pending}
              className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold tabular-nums text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              €{prices.monthly}/month
            </button>
            <button
              onClick={() => go("annual")}
              disabled={pending}
              className="flex h-11 items-center justify-center rounded-2xl border border-accent px-5 font-display text-sm font-bold tabular-nums text-accent-ink hover:bg-accent-soft disabled:opacity-50"
            >
              €{prices.annual}/year <span className="ml-1 font-sans text-[12.5px] font-medium">(15% off)</span>
            </button>
            {hasStripe ? (
              <button
                onClick={portal}
                disabled={pending}
                className="inline-flex h-11 items-center justify-center rounded-full px-3 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
              >
                Manage billing
              </button>
            ) : null}
          </>
        )}
      </div>
      {error ? <p className="mt-2.5 text-[13px] font-semibold text-risk">{error}</p> : null}
    </div>
  );
}

const GRANTABLE: Tier[] = ["free", "premium", "coach_free", "coach_pro"];

/** Admin-only per-user comp control: grants any tier for free, bypassing Stripe. */
export function AdminTierSelect({ userId, tier }: { userId: string; tier: Tier }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    setError(null);
    startTransition(async () => {
      const result = await adminSetTier(userId, next);
      if (!result.ok) setError(result.message ?? "Failed");
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        defaultValue={tier}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-xl border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent disabled:opacity-50"
      >
        {GRANTABLE.map((t) => (
          <option key={t} value={t}>{TIER_LABEL[t]}</option>
        ))}
      </select>
      {error ? <span className="text-xs text-risk">{error}</span> : null}
    </span>
  );
}
