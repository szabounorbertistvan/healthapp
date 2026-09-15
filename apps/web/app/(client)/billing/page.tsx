import { getProfile } from "@/lib/data";
import { Card } from "@/components/ui";
import { TIER_LABEL } from "@/lib/entitlements";
import { SubscribePanel, TrialBanner } from "@/components/billing";

export default async function BillingPage() {
  const profile = await getProfile();
  const tier = profile?.tier ?? "free";
  const paid = tier === "premium" && Boolean(profile?.has_stripe);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">Subscription</h1>

      <div className="mt-5 sm:mt-6">
        <TrialBanner trialEndsAt={profile?.trial_ends_at ?? null} paid={paid} />
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
            <ul className="mt-2.5 space-y-1 text-[13.5px] text-ink-soft">
              <li>✓ Training, nutrition &amp; habit logging</li>
              <li>✓ Progress charts</li>
              <li>— Progress photos</li>
            </ul>
            <p className="mt-4 text-[13px] text-ink-faint">Free forever</p>
          </div>
          <SubscribePanel
            plan="premium"
            currentTier={tier}
            hasStripe={profile?.has_stripe ?? false}
            returnPath="/billing"
          />
        </div>
        <p className="mt-3.5 text-[12.5px] leading-relaxed text-ink-faint">
          Payments are handled by Stripe. The annual plan is 12 months minus 15%; cancel anytime
          from “Manage billing”.
        </p>
      </Card>
    </div>
  );
}
