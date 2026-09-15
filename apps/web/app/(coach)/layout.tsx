import Link from "next/link";
import { redirect } from "next/navigation";
import { displayName, getProfile } from "@/lib/data";
import { NavLinks, CoachTabBar } from "@/components/nav-links";
import { NavIcon } from "@/components/client-nav";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { TIER_LABEL } from "@/lib/entitlements";
import { Logo, LogoMark } from "@/components/logo";
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
      {/* The sidebar sits on the page ground, no border: the cards are the
          only surfaces, so the eye has one kind of edge to read. */}
      <aside className="hidden w-60 shrink-0 flex-col px-3.5 pb-5 pt-6 sm:flex">
        <Link href="/" className="flex items-center gap-2 px-2.5">
          <Logo size="sm" />
        </Link>
        <p className="px-2.5 pt-2 text-xs text-ink-faint">
          {displayName(profile)} · <span className="font-semibold text-accent-ink">{TIER_LABEL[profile.tier]}</span>
        </p>
        <div className="mt-4">
          <NavLinks isAdmin={profile.role === "admin"} />
        </div>
        <div className="mt-auto space-y-3 px-1 pt-6">
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
        <header className="flex h-14 items-center justify-between gap-3 px-3 pl-4 sm:hidden">
          <span className="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-tight">
            <LogoMark className="h-6 w-6" />
            <span className="truncate">{displayName(profile)}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href="/messages"
              aria-label={t.common.nav.messages}
              title={t.common.nav.messages}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:text-ink"
            >
              <NavIcon d="M4 5h16v11H9l-5 4z" className="h-[18px] w-[18px]" />
            </Link>
            <LanguageSelector />
            <ThemeToggle />
            <SignOutButton icon className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-lg text-ink-soft hover:text-ink disabled:opacity-50" />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-28 pt-1 sm:px-10 sm:pb-12 sm:pt-7">{children}</main>
      </div>
      <CoachTabBar isAdmin={profile.role === "admin"} />
    </div>
  );
}
