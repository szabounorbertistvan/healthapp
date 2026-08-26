import { getProfile, isDemo } from "@/lib/data";
import { Card, PageTitle } from "@/components/ui";
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
    <div className="max-w-2xl">
      <PageTitle title={t.common.nav.settings} />

      <TrialBanner trialEndsAt={profile?.trial_ends_at ?? null} paid={paid} />

      <Card>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t.coachApp.settings.subscription}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between">
              <p className="font-bold">{TIER_LABEL.coach_free}</p>
              {tier !== "coach_pro" ? (
                <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink">{t.coachApp.settings.current}</span>
              ) : null}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              <li>{t.coachApp.settings.upToBefore} <b className="text-ink">{starter.maxClients}</b> {t.coachApp.settings.upToAfter}</li>
              <li>{t.coachApp.settings.noAnalytics}</li>
              <li>{t.coachApp.settings.noCustomVideos}</li>
            </ul>
            <p className="mt-4 text-sm text-ink-faint">{t.coachApp.settings.freeForever}</p>
          </div>
          <SubscribePanel
            plan="coach_pro"
            currentTier={tier}
            hasStripe={profile?.has_stripe ?? false}
            returnPath="/settings"
          />
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          {t.coachApp.settings.stripeNote}
        </p>
      </Card>

      <Card className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t.coachApp.settings.backend}</p>
        {isDemo ? (
          <div className="mt-2 space-y-2 text-sm text-ink-soft">
            <p><b className="text-ink">{t.coachApp.settings.demoTitle}</b> {t.coachApp.settings.demoIntro}</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t.coachApp.settings.step1Before} <code>supabase/</code>{t.coachApp.settings.step1After}</li>
              <li>{t.coachApp.settings.step2Copy} <code>.env.example</code> {t.coachApp.settings.step2To} <code>.env.local</code> {t.coachApp.settings.step2Fill}</li>
              <li>{t.coachApp.settings.step3}</li>
            </ol>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">{t.coachApp.settings.connected}</p>
        )}
      </Card>
    </div>
  );
}
