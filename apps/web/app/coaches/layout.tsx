import Link from "next/link";
import { getProfile } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";
import { APP_NAME } from "@/lib/brand";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginModal } from "@/components/login-modal";

/**
 * The public shell for coach pages: no app sidebar, the landing page's header
 * (language, theme, sign in / open the app). Anyone may be here — middleware
 * lets /coaches through without a session.
 */
export default async function CoachesLayout({ children }: { children: React.ReactNode }) {
  const [{ t }, profile] = await Promise.all([getI18n(), getProfile()]);
  const p = t.coachProfile.publicPage;
  const appHref = profile ? (profile.role === "client" ? "/today" : "/dashboard") : null;
  const pill = "inline-flex h-10 items-center rounded-full bg-accent px-4 text-[13.5px] font-semibold text-accent-fg hover:opacity-90 sm:px-[18px]";

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-28 sm:px-7 sm:pb-16">
      <header className="flex items-center justify-between gap-4 py-4 sm:py-[18px]">
        <Link href="/" aria-label={APP_NAME}><Logo size="sm" /></Link>
        <nav className="flex items-center gap-2 sm:gap-2.5">
          <LanguageSelector />
          <ThemeToggle />
          {appHref ? (
            <Link href="/coaches/requests" className="hidden h-10 items-center rounded-full px-3 text-[13.5px] font-semibold text-ink-soft hover:text-ink sm:inline-flex">
              {t.coachProfile.requests.mine.title}
            </Link>
          ) : null}
          {/* the private shortlist (20261102100000): only for someone who can have one */}
          {appHref ? (
            <Link href="/coaches/saved" aria-label={t.coachProfile.saved.title}
              className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-ink-soft hover:text-ink">
              <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
                <path d="M6 3h12v18l-6-4.5L6 21z" />
              </svg>
              <span className="hidden sm:inline">{t.coachProfile.saved.nav}</span>
            </Link>
          ) : null}
          {appHref ? (
            <Link href={appHref} className={pill}>{p.openApp}</Link>
          ) : (
            <LoginModal label={p.signIn} className={pill} />
          )}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
