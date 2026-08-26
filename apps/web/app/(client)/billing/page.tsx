import { getProfile } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
import { TIER_LABEL } from "@/lib/entitlements";
import { SubscribePanel, TrialBanner } from "@/components/billing";

export default async function BillingPage() {
  const profile = await getProfile();
  const tier = profile?.tier ?? "free";
  const paid = tier === "premium" && Boolean(profile?.has_stripe);

  return (
    <div className="max-w-xl">
      <PageTitle title="Subscription" />

      <TrialBanner trialEndsAt={profile?.trial_ends_at ?? null} paid={paid} />

      <Card>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Your plan</p>
        <div className="mt-3 grid gap-3">
          <div className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between">
              <p className="font-bold">{TIER_LABEL.free}</p>
              {tier === "free" ? (
                <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">Current</span>
              ) : null}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              <li>✓ Training, nutrition &amp; habit logging</li>
              <li>✓ Progress charts</li>
              <li>— Progress photos</li>
            </ul>
            <p className="mt-4 text-sm text-ink-faint">Free forever</p>
          </div>
          <SubscribePanel
            plan="premium"
            currentTier={tier}
            hasStripe={profile?.has_stripe ?? false}
            returnPath="/billing"
          />
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          Payments are handled by Stripe. The annual plan is 12 months minus 15%; cancel anytime
          from “Manage billing”.
        </p>
      </Card>
    </div>
  );
}
