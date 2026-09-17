import Link from "next/link";
import { redirect } from "next/navigation";
import { displayName, getProfile } from "@/lib/data";
import { ClientNav, ClientTabBar, NavIcon } from "@/components/client-nav";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo, LogoMark } from "@/components/logo";
import { getI18n } from "@/lib/i18n/server";
import { SignOutButton } from "@/components/sign-out-button";
import { NotificationBell } from "@/components/notification-bell";
import { UnitsProvider } from "@/lib/units/client";
import { getMyNotifications, getUnreadNotificationCount } from "@/lib/notifications-data";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  // Coaches belong in the coach workspace.
  const profile = await getProfile();
  if (!profile) redirect("/");
  if (profile.role === "coach") redirect("/dashboard");
  // An account without a username (Google sign-up, or older than the field)
  // finishes its profile before it sees anything else.
  if (!profile.username) redirect("/complete-profile");
  const name = displayName(profile);
  // One wave: the shell's two reads go out together with the dictionary.
  const [{ t }, notifications, unread] = await Promise.all([
    getI18n(),
    getMyNotifications(),
    getUnreadNotificationCount(),
  ]);

  return (
    <UnitsProvider weight={profile.weight_unit} length={profile.length_unit}>
    <div className="flex min-h-screen">
      {/* The sidebar sits on the page ground, no border: the cards are the
          only surfaces, so the eye has one kind of edge to read. */}
      <aside className="hidden w-60 shrink-0 flex-col px-3.5 pb-5 pt-6 sm:flex">
        <Link href="/" className="flex items-center gap-2 px-2.5">
          <Logo size="sm" />
        </Link>
        <p className="px-2.5 pt-2 text-xs text-ink-faint">{name}</p>
        <div className="mt-4">
          <ClientNav />
        </div>
        <div className="mt-auto space-y-3 px-1 pt-6">
          <div className="flex items-center gap-2">
            <NotificationBell notifications={notifications} unread={unread} placement="up" />
            <LanguageSelector />
            <ThemeToggle />
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The sidebar (with its language selector and sign-out) is desktop-only
            and the tab bar has no room to spare, so the phone gets its own slim
            header carrying both. Without it a client on the surface they
            actually use could never switch language or sign out. */}
        <header className="flex h-14 items-center justify-between gap-3 px-3 pl-4 sm:hidden">
          <span className="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-tight">
            <LogoMark className="h-6 w-6" />
            <span className="truncate">{name}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* The tab bar is full, so the feed gets the header — one tap from any client screen. */}
            <Link
              href="/feed"
              aria-label={t.common.social.feed}
              title={t.common.social.feed}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft hover:text-ink"
            >
              <NavIcon d="M4 5h16v11H9l-5 4z" className="h-[18px] w-[18px]" />
            </Link>
            <NotificationBell notifications={notifications} unread={unread} />
            <LanguageSelector />
            <ThemeToggle />
            <SignOutButton icon className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-lg text-ink-soft hover:text-ink disabled:opacity-50" />
          </div>
        </header>
        <main className="flex-1 px-4 pb-28 pt-1 sm:px-10 sm:pb-12 sm:pt-7">{children}</main>
      </div>
      <ClientTabBar />
    </div>
    </UnitsProvider>
  );
}
