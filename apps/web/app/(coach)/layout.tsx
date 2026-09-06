import Link from "next/link";
import { redirect } from "next/navigation";
import { isDemo } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data";
import { NavLinks } from "@/components/nav-links";
import { LanguageSelector } from "@/components/language-selector";
import { TIER_LABEL } from "@/lib/entitlements";
import { APP_NAME, APP_INITIAL } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { ViewSwitcher } from "@/components/view-switcher";
import { viewableClients } from "@/app/view-actions";
import { SignOutButton } from "@/components/sign-out-button";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  const clients = isDemo ? await viewableClients() : [];
  if (!profile) redirect("/");
  // the coach web area is for coaches and admins; clients have their own surface
  if (profile.role === "client") redirect("/today");
  const { t } = await getI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-surface p-4 sm:flex">
        <Link href="/dashboard" className="mb-2 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">{APP_INITIAL}</span>
          <span className="text-base font-extrabold tracking-tight">{APP_NAME}</span>
        </Link>
        <p className="mb-5 px-2 text-xs text-ink-faint">
          {profile.full_name} · <span className="font-semibold text-accent-ink">{TIER_LABEL[profile.tier]}</span>
        </p>
        <NavLinks isAdmin={profile.role === "admin"} />
        <div className="mt-auto space-y-3 pt-6">
          <LanguageSelector />
          {isDemo ? <ViewSwitcher surface="coach" clients={clients} /> : null}
          {isDemo ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-snug text-warn">
              <b>{t.common.demoNotice.title}</b> — {t.common.demoNotice.body}
            </p>
          ) : null}
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5 sm:p-8">{children}</main>
    </div>
  );
}
