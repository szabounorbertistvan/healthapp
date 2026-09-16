import Link from "next/link";
import { getProfile } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { DataExportCard, DeleteAccountCard, ProfileForm } from "@/components/account";

/**
 * The client's account screen. It carries only controls that change something:
 * `users.weight_unit`, `length_unit`, `check_in_weekday` and `notification_prefs`
 * exist in the schema but nothing in the app reads them yet, so a switch for
 * them here would be a dead knob — they arrive when the code that honours them
 * does. Language and theme already live in the header, so they are not repeated.
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
          fullName={profile.full_name}
          username={profile.username ?? ""}
          timezone={profile.timezone}
        />

        <DataExportCard />

        <Link
          href="/billing"
          className="rounded-3xl bg-surface px-5 py-[18px] text-[13.5px] font-semibold text-ink-soft transition hover:bg-accent-soft/40 hover:text-ink"
        >
          {t.common.nav.billing} →
        </Link>

        <DeleteAccountCard />
      </div>
    </div>
  );
}
