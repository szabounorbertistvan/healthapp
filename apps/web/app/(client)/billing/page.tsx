import { redirect } from "next/navigation";
import { getProfile } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { Card } from "@/components/ui";
import { TIER_LABEL } from "@/lib/entitlements";
import { PlanFeatureList, SubscribePanel, TrialBanner } from "@/components/billing";

/**
 * The client's plan. Only where the paywall applies (app_flags.paywall, or a
 * preview user): until then nothing is gated, there is nothing to buy, and
 * the route keeps sending people to Account as it has since 2026-09-17.
 */
export default async function BillingPage() {
  const [profile, { t }] = await Promise.all([getProfile(), getI18n()]);
  if (!profile?.paywall) redirect("/account");
  const tier = profile.tier;
  const paid = tier === "premium" && profile.has_stripe;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">Subscription</h1>

      <div className="mt-5 sm:mt-6">
        {profile.tier_via_coach ? (
          <div className="mb-4 rounded-3xl bg-accent-soft px-5 py-[18px] text-[13.5px] leading-relaxed text-accent-ink">
            {t.common.plan.viaCoach}
          </div>
        ) : (
          <TrialBanner trialEndsAt={profile.trial_ends_at} paid={paid} />
        )}
      </div>

      <Card plain>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Your plan</p>
        <div className="mt-3 grid gap-3">
          <div className="rounded-2xl bg-bg px-4 py-[18px]">
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-lg font-bold tracking-tight">{TIER_LABEL.free}</p>
              {tier === "free" ? (
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Current</span>
              ) : null}
            </div>
            <PlanFeatureList list="free" className="mt-2.5" />
            <p className="mt-4 text-[13px] text-ink-faint">Free forever</p>
          </div>
          {profile.tier_via_coach ? null : (
            <SubscribePanel plan="premium" currentTier={tier} hasStripe={profile.has_stripe} returnPath="/billing" />
          )}
        </div>
        <p className="mt-3.5 text-[12.5px] leading-relaxed text-ink-faint">
          Payments are handled by Stripe. The annual plan is 12 months minus 15%; cancel anytime
          from “Manage billing”.
        </p>
      </Card>
    </div>
  );
}
