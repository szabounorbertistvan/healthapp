"use client";
import { useI18n } from "@/lib/i18n/client";
import type { CoachCatalog, MyCoachProfile } from "@/lib/coach-profile";
import { Card } from "../ui";
import { CoachProfilePreview } from "./preview";
import { buildPreview, initialDraft } from "./wizard";

/** A profile outside `draft`: what is stored, shown the way the public page shows it. */
export function CoachProfileReadOnly({
  data, catalog, displayName, avatarUrl,
}: {
  data: MyCoachProfile;
  catalog: CoachCatalog;
  displayName: string;
  avatarUrl: string | null;
}) {
  const { t } = useI18n();
  const preview = buildPreview({
    data, draft: initialDraft(data), services: data.services, certifications: data.certifications,
    catalog, displayName, avatarUrl,
  });
  return (
    <Card plain>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{t.coachProfile.publish.preview}</p>
      <div className="mt-3 rounded-3xl bg-bg p-2 sm:p-3">
        <CoachProfilePreview profile={preview} />
      </div>
    </Card>
  );
}
