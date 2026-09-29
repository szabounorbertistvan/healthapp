import Link from "next/link";
import { redirect } from "next/navigation";
import { displayName, getProfile } from "@/lib/data";
import { NavLinks, CoachTabBar } from "@/components/nav-links";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
// Trial / Pro hidden for now (2026-09-17) — commented out, not removed; restore when billing goes live.
// import { TIER_LABEL } from "@/lib/entitlements";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { FeedbackButton } from "@/components/feedback";
import { Avatar } from "@/components/social";
import { PlanProvider } from "@/lib/plan-client";
import { getPlan } from "@/lib/plan";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/");
  // an admin switched this account off; the page explains and offers sign-out
  if (profile.suspended_at) redirect("/suspended");
  // the coach web area is for coaches and admins; clients have their own surface
  if (profile.role === "client") redirect("/today");
  if (!profile.username) redirect("/complete-profile");
  const plan = await getPlan();

  return (
    <PlanProvider plan={{ e: plan.e, upgrade: plan.upgrade, libraryVideos: profile.role === "admin" }}>
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
        <Link href="/settings" className="mt-2.5 flex items-center gap-2 px-2.5 text-xs text-ink-faint hover:text-ink">
          <Avatar name={displayName(profile)} url={profile.avatar_url} size="h-7 w-7" />
          <span className="truncate">
            {displayName(profile)}
            {/* Trial / Pro hidden for now: · <span className="font-semibold text-accent-ink">{TIER_LABEL[profile.tier]}</span> */}
          </span>
        </Link>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <NavLinks isAdmin={profile.role === "admin"} />
        </div>
        <div className="mt-auto space-y-3 px-1 pt-6">
          <div className="-mx-1"><FeedbackButton /></div>
          <div className="flex items-center gap-2">
            <LanguageSelector />
            <ThemeToggle />
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* No phone header: the bottom tab bar and its "More" sheet (messages,
            settings, language, theme, sign-out) are the only menu on a phone. */}
        <main className="min-w-0 flex-1 px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10 sm:pb-12 sm:pt-7">{children}</main>
      </div>
      <CoachTabBar isAdmin={profile.role === "admin"} />
    </div>
    </PlanProvider>
  );
}
