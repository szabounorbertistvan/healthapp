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

export function TrialBanner({ trialEndsAt, paid }: { trialEndsAt: string | null; paid: boolean }) {
  if (paid) return null;
  const days = trialDaysLeft(trialEndsAt);
  if (days === null) return null;
  return (
    <div className="mb-4 rounded-xl border border-accent bg-accent-soft px-4 py-3 text-sm text-accent-ink">
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
  const [demo, setDemo] = useState(false);
  const [pending, startTransition] = useTransition();
  const prices = PLAN_PRICES[plan];
  const e = ENTITLEMENTS[plan];
  const subscribed = currentTier === plan && hasStripe;

  function go(interval: PlanInterval) {
    setError(null);
    startTransition(async () => {
      const result = await startCheckout(plan, interval, returnPath);
      if (result.demo) return setDemo(true);
      if (result.ok && result.url) window.location.assign(result.url);
      else setError(result.message ?? "Could not start checkout");
    });
  }

  function portal() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortal(returnPath);
      if (result.demo) return setDemo(true);
      if (result.ok && result.url) window.location.assign(result.url);
      else setError(result.message ?? "Could not open billing portal");
    });
  }

  return (
    <div className="rounded-xl border-2 border-accent p-4">
      <div className="flex items-center justify-between">
        <p className="font-bold">{TIER_LABEL[plan]}</p>
        {currentTier === plan ? (
          <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">
            Current
          </span>
        ) : null}
      </div>
      <ul className="mt-2 space-y-1 text-sm text-ink-soft">
        {plan === "coach_pro" ? (
          <>
            <li>Up to <b className="text-ink">{e.maxClients}</b> clients</li>
            <li>✓ Advanced analytics</li>
            <li>✓ Custom exercise videos</li>
          </>
        ) : (
          <>
            <li>✓ Progress photos</li>
            <li>✓ Charts, habits &amp; streaks</li>
            <li>✓ Full training &amp; nutrition tracking</li>
          </>
        )}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {subscribed ? (
          <button
            onClick={portal}
            disabled={pending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Opening…" : "Manage billing"}
          </button>
        ) : (
          <>
            <button
              onClick={() => go("monthly")}
              disabled={pending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              €{prices.monthly}/month
            </button>
            <button
              onClick={() => go("annual")}
              disabled={pending}
              className="rounded-lg border-2 border-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-soft disabled:opacity-50"
            >
              €{prices.annual}/year <span className="font-normal">(15% off)</span>
            </button>
            {hasStripe ? (
              <button
                onClick={portal}
                disabled={pending}
                className="text-sm text-ink-soft underline disabled:opacity-50"
              >
                Manage billing
              </button>
            ) : null}
          </>
        )}
      </div>
      {demo ? (
        <p className="mt-2 text-xs text-ink-faint">Demo mode — checkout is disabled.</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-risk">{error}</p> : null}
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
        className="rounded-lg border border-line bg-surface px-2 py-1 text-sm disabled:opacity-50"
      >
        {GRANTABLE.map((t) => (
          <option key={t} value={t}>{TIER_LABEL[t]}</option>
        ))}
      </select>
      {error ? <span className="text-xs text-risk">{error}</span> : null}
    </span>
  );
}
