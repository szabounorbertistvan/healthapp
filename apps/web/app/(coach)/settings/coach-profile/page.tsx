import Link from "next/link";
import { getProfile, displayName } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { getCoachCatalog, getMyCoachProfile } from "@/lib/coach-profile-data";
import { parseStep } from "@/lib/coach-onboarding";
import { BecomeCoachCard, CoachProfileStatusPanel } from "@/components/coach-profile/status";
import { CoachProfileWizard } from "@/components/coach-profile/wizard";
import { CoachProfileReadOnly } from "@/components/coach-profile/read-only";

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
  const [{ step }, { t }, profile, mine, catalog] = await Promise.all([
    searchParams, getI18n(), getProfile(), getMyCoachProfile(), getCoachCatalog(),
  ]);
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-3xl">
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
              <CoachProfileStatusPanel profile={mine.profile} />
            ) : null}
            {mine.profile.status === "draft" ? (
              <CoachProfileWizard
                data={mine}
                catalog={catalog}
                step={parseStep(step)}
                displayName={displayName(profile)}
                avatarUrl={profile.avatar_url}
                photoUploads={cloudinaryConfigured()}
              />
            ) : (
              <CoachProfileReadOnly data={mine} catalog={catalog} displayName={displayName(profile)} avatarUrl={profile.avatar_url} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
