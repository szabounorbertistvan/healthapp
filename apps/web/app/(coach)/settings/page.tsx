import { getProfile } from "@/lib/data";
import { Card } from "@/components/ui";
import { ENTITLEMENTS, TIER_LABEL } from "@/lib/entitlements";
import { SubscribePanel, TrialBanner } from "@/components/billing";
import { getI18n } from "@/lib/i18n/server";

export default async function SettingsPage() {
  const { t } = await getI18n();
  const profile = await getProfile();
  const tier = profile?.tier ?? "free";
  const paid = tier === "coach_pro" && Boolean(profile?.has_stripe);
  const starter = ENTITLEMENTS.coach_free;

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{t.common.nav.settings}</h1>
      </header>

      <div className="mt-5 sm:mt-6">
        <TrialBanner trialEndsAt={profile?.trial_ends_at ?? null} paid={paid} />

        <Card plain>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t.coachApp.settings.subscription}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {/* The free plan, shaped like the paid panel next to it. */}
            <div className="rounded-2xl bg-bg px-4 py-[18px]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-display text-lg font-bold tracking-tight">{TIER_LABEL.coach_free}</p>
                {tier !== "coach_pro" ? (
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                    {t.coachApp.settings.current}
                  </span>
                ) : null}
              </div>
              <ul className="mt-2.5 space-y-1 text-[13.5px] text-ink-soft">
                <li>{t.coachApp.settings.upToBefore} <b className="text-ink">{starter.maxClients}</b> {t.coachApp.settings.upToAfter}</li>
                <li>{t.coachApp.settings.noAnalytics}</li>
                <li>{t.coachApp.settings.noCustomVideos}</li>
              </ul>
              <p className="mt-4 text-[12.5px] text-ink-faint">{t.coachApp.settings.freeForever}</p>
            </div>
            <SubscribePanel
              plan="coach_pro"
              currentTier={tier}
              hasStripe={profile?.has_stripe ?? false}
              returnPath="/settings"
            />
          </div>
          <p className="mt-3.5 text-[12.5px] text-ink-faint">
            {t.coachApp.settings.stripeNote}
          </p>
        </Card>
      </div>
    </div>
  );
}
