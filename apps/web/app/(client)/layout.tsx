import Link from "next/link";
import { redirect } from "next/navigation";
import { displayName, getProfile } from "@/lib/data";
import { ClientNav, ClientTabBar } from "@/components/client-nav";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/social";
import { NotificationBell } from "@/components/notification-bell";
import { UnitsProvider } from "@/lib/units/client";
import { RestTimerProvider } from "@/lib/rest-timer/client";
import { PlanProvider } from "@/lib/plan-client";
import { getPlan } from "@/lib/plan";
import { RestTimerBar } from "@/components/rest-timer-bar";
import { OfflineSetsProvider } from "@/lib/offline/sync";
import { OfflineSetsNotice } from "@/components/offline-sets-notice";
import { FeedbackButton } from "@/components/feedback";
import { getMyNotifications, getUnreadNotificationCount } from "@/lib/notifications-data";
import { CONSENT_VERSION } from "@/lib/legal";

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
  // finishes its profile before it sees anything else, and nobody sees their
  // health data here without the current consent on record (20261113110000).
  if (!profile.username || profile.consent_version !== CONSENT_VERSION) redirect("/complete-profile");
  const name = displayName(profile);
  // One wave: the shell's reads go out together.
  const [notifications, unread, plan] = await Promise.all([
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
    {/* Sets logged without a connection wait on the device and replay from
        here, whichever (client) screen is open when the signal returns. */}
    <OfflineSetsProvider userId={profile.id}>
    <div className="flex min-h-screen">
      {/* The sidebar sits on the page ground, no border: the cards are the
          only surfaces, so the eye has one kind of edge to read. */}
      {/* Sticky and viewport-tall: the row container is as tall as the page,
          so without this the bottom block (feedback, sign-out) sat at the end
          of a long feed, a full scroll away. Only the nav list scrolls; the
          aside itself must not clip, or the bell's popover (wider than the
          sidebar) would be cut off. z-20 because sticky makes the aside its
          own stacking context: without a z-index it sits at level 0 in DOM
          order, and anything positioned or filtered in <main> (a reaction
          icon, a photo) paints over the popover where it reaches past the
          sidebar. */}
      <aside className="sticky top-0 z-20 hidden h-screen w-60 shrink-0 flex-col self-start px-3.5 pb-5 pt-6 sm:flex">
        <Link href="/" className="flex items-center gap-2 px-2.5">
          <Logo size="sm" />
        </Link>
        {/* Who is signed in, one tap from editing it. */}
        <Link href="/account" className="mt-2.5 flex items-center gap-2 px-2.5 text-xs text-ink-faint hover:text-ink">
          <Avatar name={name} url={profile.avatar_url} size="h-7 w-7" />
          <span className="truncate">{name}</span>
        </Link>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
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
        {/* No phone header: the bottom tab bar is the only menu on a phone, and
            its "More" sheet carries the feed, notifications, language, theme
            and sign-out that a header used to duplicate. */}
        <main className="flex min-w-0 flex-1 flex-col px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10 sm:pb-12 sm:pt-7">
          <OfflineSetsNotice />
          <div className="flex-1">{children}</div>
          <RestTimerBar />
        </main>
      </div>
      <ClientTabBar coach={coach} unread={unread} />
    </div>
    </OfflineSetsProvider>
    </RestTimerProvider>
    </UnitsProvider>
    </PlanProvider>
  );
}
