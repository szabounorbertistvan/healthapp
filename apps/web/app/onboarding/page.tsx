import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, displayName } from "@/lib/data";
import { getOnboardingState, getSetupSnapshot } from "@/lib/onboarding";
import { audienceOf, openingStep, setupProgress } from "@/lib/onboarding-model";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { CONSENT_VERSION } from "@/lib/legal";
import { getI18n } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { OnboardingProvider } from "@/components/onboarding/provider";
import { OnboardingFlow, type FlowPhase } from "@/components/onboarding/flow";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.onboarding.setup.title, robots: { index: false, follow: false } };
}

/**
 * The welcome cards and setup steps (components/onboarding/flow.tsx). /today
 * and /dashboard send a brand-new account here once; "Getting started" in the
 * sidebar opens it again with ?intro=1; the "Finish setting up" card opens it
 * at the next open step; ?step=<id> opens one step.
 *
 * Its own focused shell, like /complete-profile: no app navigation to wander
 * off into mid-step, but every screen has a way out ("Finish later").
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ intro?: string; step?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login?next=/onboarding");
  if (profile.suspended_at) redirect("/suspended");
  if (!profile.username || profile.consent_version !== CONSENT_VERSION) redirect("/complete-profile");

  const [{ t }, state, snapshot, params] = await Promise.all([
    getI18n(),
    getOnboardingState(),
    getSetupSnapshot(profile),
    searchParams,
  ]);
  const audience = audienceOf(profile.role);
  // Unknown state (a failed read) is shown as a fresh start; marks made now are
  // kept on the device by the provider and sent again on the next load.
  const known = state ?? {};
  const progress = setupProgress(audience, snapshot.facts, known);
  const phase: FlowPhase =
    params.intro === "1" || known.welcome === undefined ? "intro"
      : progress.answered && !params.step ? "finish"
        : "setup";

  return (
    <main className="min-h-screen px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-6">
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <Link href={audience === "client" ? "/today" : "/dashboard"} aria-label={t.onboarding.setup.later}>
          <Logo size="sm" />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto mt-6 max-w-2xl sm:mt-10">
        <OnboardingProvider userId={profile.id} initial={state}>
          <OnboardingFlow
            audience={audience}
            phase={phase}
            step={openingStep(audience, progress, params.step)}
            facts={snapshot.facts}
            name={displayName(profile)}
            avatarUrl={profile.avatar_url}
            photoUploads={cloudinaryConfigured()}
            weightUnit={profile.weight_unit}
            lengthUnit={profile.length_unit}
            timezone={profile.timezone}
            goal={snapshot.goal}
            coached={snapshot.coached}
            coachProfileStatus={snapshot.coachProfileStatus}
            hasClients={snapshot.hasClients}
          />
        </OnboardingProvider>
      </div>
    </main>
  );
}
