import Link from "next/link";
import { redirect } from "next/navigation";
import { displayName, getProfile } from "@/lib/data";
import { ClientNav, ClientTabBar } from "@/components/client-nav";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { getI18n } from "@/lib/i18n/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  // Coaches belong in the coach workspace.
  const profile = await getProfile();
  if (!profile) redirect("/");
  if (profile.role === "coach") redirect("/dashboard");
  // An account without a username (Google sign-up, or older than the field)
  // finishes its profile before it sees anything else.
  if (!profile.username) redirect("/complete-profile");
  const name = displayName(profile);
  const { t } = await getI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-surface p-4 sm:flex">
        <Link href="/" className="mb-2 flex items-center gap-2 px-2">
          <Logo size="sm" />
        </Link>
        <p className="mb-5 px-2 text-xs text-ink-faint">{name}</p>
        <ClientNav />
        <div className="mt-auto space-y-3 pt-6">
          <div className="flex items-center gap-2">
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
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2 sm:hidden">
          <span className="truncate text-sm font-bold tracking-tight">{name}</span>
          <div className="flex shrink-0 items-center gap-2">
            {/* The tab bar is full, so the feed gets the header — one tap from any client screen. */}
            <Link
              href="/feed"
              aria-label={t.common.social.feed}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-lg hover:border-accent"
            >
              💬
            </Link>
            <LanguageSelector />
            <ThemeToggle />
            {/* Text link kept, but with a 44px hit area; the negative margin
                lets the padding reach the header edge without moving the label. */}
            <SignOutButton icon className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-surface text-lg text-ink-soft hover:border-accent hover:text-ink disabled:opacity-50" />
          </div>
        </header>
        <main className="flex-1 p-5 pb-28 sm:p-8 sm:pb-8">{children}</main>
      </div>
      <ClientTabBar />
    </div>
  );
}
