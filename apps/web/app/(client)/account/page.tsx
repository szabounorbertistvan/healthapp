import Link from "next/link";
import { getProfile } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { DataExportCard, DeleteAccountCard, ProfileForm } from "@/components/account";
import { RestTimerCard } from "@/components/rest-settings";

/**
 * The client's account screen. It carries only controls that change something:
 * `notification_prefs` is the one column still without a control: nothing reads
 * it, so a switch here would be a dead knob. Language and theme already live in
 * the header, so they are not repeated.
 */
export default async function AccountPage() {
  const [{ t }, profile] = await Promise.all([getI18n(), getProfile()]);
  if (!profile) return null;
  const a = t.clientApp.account;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{a.title}</h1>

      <div className="mt-5 grid gap-3.5 sm:mt-6">
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

        <RestTimerCard prefs={profile.rest_prefs} />

        <DataExportCard />

        {/* Trial / Pro hidden for now (2026-09-17) — commented out, not removed; restore when billing goes live.
        <Link
          href="/billing"
          className="rounded-3xl bg-surface px-5 py-[18px] text-[13.5px] font-semibold text-ink-soft transition hover:bg-accent-soft/40 hover:text-ink"
        >
          {t.common.nav.billing} →
        </Link>
        */}

        <DeleteAccountCard />
      </div>
    </div>
  );
}
