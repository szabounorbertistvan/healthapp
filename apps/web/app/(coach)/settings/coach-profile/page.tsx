import Link from "next/link";
import { Suspense } from "react";
import { MarketplaceTabs } from "@/components/marketplace-tabs";
import { getProfile, displayName } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { getCoachCatalog, getMyCoachApplication, getMyCoachProfile } from "@/lib/coach-profile-data";
import { parseStep } from "@/lib/coach-onboarding";
import { BecomeCoachCard, CoachProfileStatusPanel, CoachRevisionBanner } from "@/components/coach-profile/status";
import { CoachProfileWizard } from "@/components/coach-profile/wizard";
import { CoachProfileReadOnly } from "@/components/coach-profile/read-only";
import { ServicesManager } from "@/components/coach-profile/lists";
import { VerificationCard } from "@/components/coach-profile/verification";
import { CoachApplicationCard } from "@/components/coach-profile/application";

/**
 * The coach's public profile, built in six steps (Coach Discovery). Under
 * (coach), so the layout already keeps clients out (→ /today); a client gets
 * here through "Become a coach" on /account, which makes them `both` first.
 *
 * A draft opens the wizard at ?step=n. Any other status shows where the
 * profile stands and a read-only preview: the database refuses content
 * writes outside `draft`, and "Edit profile" withdraws it to draft first.
 */
export default async function CoachProfilePage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const [{ step }, { t }, profile, mine, catalog, application] = await Promise.all([
    searchParams, getI18n(), getProfile(), getMyCoachProfile(), getCoachCatalog(), getMyCoachApplication(),
  ]);
  if (!profile) return null;
  const disciplines = mine
    ? catalog.specializations.filter((s) => mine.specializations.some((m) => m.slug === s.slug))
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <Suspense><MarketplaceTabs /></Suspense>
      <Link href="/settings" className="text-[13px] font-semibold text-ink-faint hover:text-ink">
        ← {t.common.nav.settings}
      </Link>
      <div className="mt-4 grid gap-3.5">
        {!mine ? (
          // a coach account that never made a profile
          <BecomeCoachCard />
        ) : (
          <>
            {mine.profile.status !== "draft" || mine.profile.review_note ? (
              <CoachProfileStatusPanel profile={mine.profile} editing={Boolean(mine.revision)} showNote={!application} />
            ) : null}
            {/* a live profile being edited as a copy (20261108100000): the page stays up */}
            {mine.revision ? <CoachRevisionBanner revision={mine.revision} /> : null}
            {/* the admin review every profile passes before it is public (20261118100000) */}
            {application ? (
              <div id="application" className="scroll-mt-24">
                <CoachApplicationCard application={application} uploads={cloudinaryConfigured()} disciplines={disciplines} />
              </div>
            ) : null}
            {/* Voinic Verified is separate from publishing (20261101100000): the coach asks, an admin decides */}
            <div id="verification" className="scroll-mt-24"><VerificationCard data={mine} /></div>
            {mine.profile.status === "draft" || mine.revision ? (
              <CoachProfileWizard
                data={mine}
                catalog={catalog}
                // a revision of a live profile is reviewed as a change, not as a new application
                documentsMissing={mine.revision ? [] : application?.missing ?? []}
                step={parseStep(step)}
                displayName={displayName(profile)}
                avatarUrl={profile.avatar_url}
                photoUploads={cloudinaryConfigured()}
              />
            ) : (
              <>
                {/* switching and ordering services needs no review (20261031100000); a suspended profile changes nothing */}
                {mine.profile.status !== "suspended" && mine.services.length > 0 ? <ServicesManager initial={mine.services} /> : null}
                <CoachProfileReadOnly data={mine} catalog={catalog} displayName={displayName(profile)} avatarUrl={profile.avatar_url} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
