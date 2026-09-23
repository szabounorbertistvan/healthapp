import { getProfile } from "@/lib/data";
// The subscription card shows only where the paywall applies (profile.paywall:
// app_flags.paywall, or a preview user). Hidden for everyone else since 2026-09-17.
import { Card } from "@/components/ui";
import { TIER_LABEL } from "@/lib/entitlements";
import { PlanFeatureList, SubscribePanel, TrialBanner } from "@/components/billing";
import { getI18n } from "@/lib/i18n/server";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { ProfileForm } from "@/components/account";
import { RestTimerCard } from "@/components/rest-settings";

export default async function SettingsPage() {
  const { t } = await getI18n();
  const profile = await getProfile();
  if (!profile) return null;
  const tier = profile.tier;
  const paid = tier === "coach_pro" && profile.has_stripe;

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{t.common.nav.settings}</h1>
      </header>

      <div className="mt-5 grid gap-3.5 sm:mt-6">
        {/* The coach had no way to edit their own profile until now: the form
            is the client's, minus the check-in day and leaderboard switch. */}
        <ProfileForm
          role={profile.role}
          avatarUrl={profile.avatar_url}
          photoUploads={cloudinaryConfigured()}
          fullName={profile.full_name}
          username={profile.username ?? ""}
          city={profile.city ?? ""}
          bio={profile.bio ?? ""}
          timezone={profile.timezone}
          checkInWeekday={profile.check_in_weekday}
          leaderboardVisibility={profile.leaderboard_visibility}
          weightUnit={profile.weight_unit}
          lengthUnit={profile.length_unit}
        />

        {/* A coach trains too (My training): their own rest between sets. */}
        <RestTimerCard prefs={profile.rest_prefs} />

        {profile.paywall ? (
        <>
        <TrialBanner trialEndsAt={profile.trial_ends_at} paid={paid} />

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
              <PlanFeatureList list="coachFree" className="mt-2.5" />
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
        </>
        ) : null}
      </div>
    </div>
  );
}
