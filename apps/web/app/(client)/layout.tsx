import Link from "next/link";
import { redirect } from "next/navigation";
import { displayName, getProfile } from "@/lib/data";
import { ClientNav, ClientTabBar, NavIcon } from "@/components/client-nav";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo, LogoMark } from "@/components/logo";
import { getI18n } from "@/lib/i18n/server";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/social";
import { NotificationBell } from "@/components/notification-bell";
import { UnitsProvider } from "@/lib/units/client";
import { RestTimerProvider } from "@/lib/rest-timer/client";
import { PlanProvider } from "@/lib/plan-client";
import { getPlan } from "@/lib/plan";
import { RestTimerBar } from "@/components/rest-timer-bar";
import { FeedbackButton } from "@/components/feedback";
import { getMyNotifications, getUnreadNotificationCount } from "@/lib/notifications-data";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/");
  // an admin switched this account off; the page explains and offers sign-out
  if (profile.suspended_at) redirect("/suspended");
  // A coach trains too, so this surface is theirs as well: every read under it
  // is scoped to the signed-in user (lib/actor.ts) and every RLS policy on the
  // tables it touches is owner-based, so a coach logging their own workout
  // needs no second implementation and no new policy. What they do need is a
  // door back — see BackToCoaching in components/client-nav.tsx.
  const coach = profile.role !== "client";
  // An account without a username (Google sign-up, or older than the field)
  // finishes its profile before it sees anything else.
  if (!profile.username) redirect("/complete-profile");
  const name = displayName(profile);
  // One wave: the shell's two reads go out together with the dictionary.
  const [{ t }, notifications, unread, plan] = await Promise.all([
    getI18n(),
    getMyNotifications(),
    getUnreadNotificationCount(),
    getPlan(),
  ]);

  return (
    <PlanProvider plan={{ e: plan.e, upgrade: plan.upgrade, libraryVideos: profile.role === "admin" }}>
    <UnitsProvider weight={profile.weight_unit} length={profile.length_unit}>
    {/* The rest timer lives here, above every (client) route, so a countdown
        started in the set logger follows the person to Today and back. */}
    <RestTimerProvider prefs={profile.rest_prefs}>
    <div className="flex min-h-screen">
      {/* The sidebar sits on the page ground, no border: the cards are the
          only surfaces, so the eye has one kind of edge to read. */}
      <aside className="hidden w-60 shrink-0 flex-col px-3.5 pb-5 pt-6 sm:flex">
        <Link href="/" className="flex items-center gap-2 px-2.5">
          <Logo size="sm" />
        </Link>
        {/* Who is signed in, one tap from editing it. */}
        <Link href="/account" className="mt-2.5 flex items-center gap-2 px-2.5 text-xs text-ink-faint hover:text-ink">
          <Avatar name={name} url={profile.avatar_url} size="h-7 w-7" />
          <span className="truncate">{name}</span>
        </Link>
        <div className="mt-4">
          <ClientNav coach={coach} />
        </div>
        <div className="mt-auto space-y-3 px-1 pt-6">
          <div className="-mx-1"><FeedbackButton /></div>
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
        {/* Sticky and glass: a floating strip the page scrolls under. */}
        <header className="glass glass--strong sticky top-2 z-10 mx-3 flex h-14 items-center justify-between gap-3 rounded-2xl px-2 pl-3.5 sm:hidden">
          <span className="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-tight">
            <LogoMark className="h-6 w-6" px={24} />
            <span className="truncate">{name}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* The tab bar is full, so the feed gets the header — one tap from any client screen. */}
            <Link
              href="/feed"
              aria-label={t.common.social.feed}
              title={t.common.social.feed}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg glass glass--subtle glass--interactive text-ink-soft hover:text-ink"
            >
              <NavIcon d="M4 5h16v11H9l-5 4z" className="h-[18px] w-[18px]" />
            </Link>
            <NotificationBell notifications={notifications} unread={unread} />
            <LanguageSelector />
            <ThemeToggle />
            <SignOutButton icon className="inline-flex h-11 w-11 items-center justify-center text-lg disabled:opacity-50 rounded-lg glass glass--subtle glass--interactive text-ink-soft hover:text-ink" />
          </div>
        </header>
        <main className="flex min-w-0 flex-1 flex-col px-4 pb-28 pt-3 sm:px-10 sm:pb-12 sm:pt-7">
          <div className="flex-1">{children}</div>
          <RestTimerBar />
        </main>
      </div>
      <ClientTabBar coach={coach} />
    </div>
    </RestTimerProvider>
    </UnitsProvider>
    </PlanProvider>
  );
}
