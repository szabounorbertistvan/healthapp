import Link from "next/link";
import { redirect } from "next/navigation";
import { displayName, getProfile } from "@/lib/data";
import { NavLinks, CoachTabBar } from "@/components/nav-links";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { TIER_LABEL } from "@/lib/entitlements";
import { Logo } from "@/components/logo";
import { getI18n } from "@/lib/i18n/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/");
  // the coach web area is for coaches and admins; clients have their own surface
  if (profile.role === "client") redirect("/today");
  if (!profile.username) redirect("/complete-profile");
  const { t } = await getI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-surface p-4 sm:flex">
        <Link href="/" className="mb-2 flex items-center gap-2 px-2">
          <Logo size="sm" />
        </Link>
        <p className="mb-5 px-2 text-xs text-ink-faint">
          {displayName(profile)} · <span className="font-semibold text-accent-ink">{TIER_LABEL[profile.tier]}</span>
        </p>
        <NavLinks isAdmin={profile.role === "admin"} />
        <div className="mt-auto space-y-3 pt-6">
          <div className="flex items-center gap-2">
            <LanguageSelector />
            <ThemeToggle />
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The sidebar is desktop-only, so without this the coach surface had no
            header, no nav and no way out on a phone. Mirrors the client header:
            who you are on the left, and the controls the tab bar has no room
            for on the right — messages first, for the same reason the client
            header carries the feed. */}
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2 sm:hidden">
          <span className="truncate text-sm font-bold tracking-tight">{displayName(profile)}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/messages"
              aria-label={t.common.nav.messages}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-lg hover:border-accent"
            >
              ✉️
            </Link>
            <LanguageSelector />
            <ThemeToggle />
            <SignOutButton icon className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-lg text-ink-soft hover:border-accent hover:text-ink disabled:opacity-50" />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-5 pb-28 sm:p-8 sm:pb-8">{children}</main>
      </div>
      <CoachTabBar isAdmin={profile.role === "admin"} />
    </div>
  );
}
