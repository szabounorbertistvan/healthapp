import Link from "next/link";
import { isDemo } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo, LogoMark, Wordmark } from "@/components/logo";
import { LoginModal } from "@/components/login-modal";

export default async function LandingPage() {
  const [{ t }, profile] = await Promise.all([getI18n(), isDemo ? null : getProfile()]);
  const l = t.landing;
  // Signed-in visitors (they got here via the logo) get a way back into the app.
  const appHref = profile ? (profile.role === "client" ? "/today" : "/dashboard") : null;
  return (
    <main className="mx-auto max-w-5xl px-6 pb-20">
      <header className="flex items-center justify-between py-6">
        <Link href="/" aria-label={APP_NAME}>
          <Logo size="sm" />
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          <LanguageSelector />
          <ThemeToggle />
          {appHref ? (
            <Link href={appHref} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90">
              {l.openApp}
            </Link>
          ) : (
            <LoginModal label={l.signIn} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:opacity-90" />
          )}
        </nav>
      </header>

      {/* Hero — the logo lockup as it appears in the brand: mark, wordmark, tagline. */}
      <section className="py-16 text-center sm:py-24">
        <LogoMark className="mx-auto h-36 w-36 sm:h-44 sm:w-44" />
        <Wordmark className="mx-auto mt-8 h-10 sm:h-12" />
        <p className="mt-3 flex items-center justify-center gap-3 font-display text-xs font-semibold uppercase tracking-[0.28em] text-accent-ink sm:text-sm">
          <span className="h-px w-8 bg-accent" aria-hidden />
          {APP_TAGLINE}
          <span className="h-px w-8 bg-accent" aria-hidden />
        </p>

        <h1 className="mx-auto mt-12 max-w-2xl text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {l.heroTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-soft">{fill(l.heroBody, { app: APP_NAME })}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {appHref ? (
            <Link href={appHref} className="rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg hover:opacity-90">
              {l.openApp}
            </Link>
          ) : (
            <LoginModal label={l.startFree} mode="signup" className="rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg hover:opacity-90" />
          )}
          {isDemo ? (
            <>
              <Link href="/dashboard" className="rounded-xl border border-line bg-surface px-6 py-3 font-semibold text-ink-soft hover:border-accent">
                {l.browseCoachDemo}
              </Link>
              <Link href="/today" className="rounded-xl border border-line bg-surface px-6 py-3 font-semibold text-ink-soft hover:border-accent">
                {l.browseClientDemo}
              </Link>
            </>
          ) : null}
        </div>
      </section>

      {/* The four pillars from the logo strip: dumbbell · clipboard · bowl · chart. */}
      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {l.pillars.map((p, i) => (
          <div key={p.title} className="bg-surface p-6">
            <span className="text-accent">{PILLAR_ICONS[i]}</span>
            <p className="mt-4 font-bold">{p.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{p.body}</p>
          </div>
        ))}
      </section>

      <Benefits title={l.forYou} items={l.clientBenefits} columns={2} />
      <Benefits title={l.forCoaches} items={l.coachBenefits} columns={3} />

      <section className="rounded-2xl border border-line bg-surface p-8 text-center">
        <h2 className="text-xl font-bold">{l.pricingTitle}</h2>
        <div className="mx-auto mt-6 grid max-w-2xl gap-4 sm:grid-cols-3">
          <PricingTier name={l.pricingFree} body={l.pricingFreeBody} />
          <PricingTier name={l.pricingPremium} body={l.pricingPremiumBody} highlighted />
          <PricingTier name={l.pricingCoach} body={l.pricingCoachBody} />
        </div>
        <p className="mt-6 text-xs text-ink-faint">{l.pricingFootnote}</p>
      </section>

      <footer className="flex flex-col items-center gap-3 pt-12 text-center text-xs text-ink-faint">
        <Logo size="sm" tagline />
        <p>
          <Link href="/privacy" className="hover:underline">{t.common.legal.privacy}</Link>
          {" · "}
          <Link href="/terms" className="hover:underline">{t.common.legal.terms}</Link>
          {" · "}
          {t.common.legal.foodData}
        </p>
      </footer>
    </main>
  );
}

const ICON = "h-7 w-7";
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const PILLAR_ICONS = [
  // dumbbell
  <svg key="dumbbell" viewBox="0 0 24 24" className={ICON} {...STROKE} aria-hidden>
    <path d="M2 10v4M22 10v4M5 8v8M19 8v8M8 6v12M16 6v12M8 12h8" />
  </svg>,
  // clipboard
  <svg key="clipboard" viewBox="0 0 24 24" className={ICON} {...STROKE} aria-hidden>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4.5V3h6v1.5M8.5 11l1.5 1.5L13 9.5M8.5 16l1.5 1.5L13 14.5" />
  </svg>,
  // bowl with leaf
  <svg key="bowl" viewBox="0 0 24 24" className={ICON} {...STROKE} aria-hidden>
    <path d="M3 12h18a9 9 0 0 1-18 0zM8 12c0-3 2-5 5-6 2 2 3 4 1 6" />
  </svg>,
  // rising chart
  <svg key="chart" viewBox="0 0 24 24" className={ICON} {...STROKE} aria-hidden>
    <path d="M4 20h16M6 17v-4M11 17V9M16 17v-6M4 8l5-3 4 3 7-5M17 3h3v3" />
  </svg>,
];

function Benefits({
  title, items, columns,
}: { title: string; items: readonly { title: string; body: string }[]; columns: 2 | 3 }) {
  return (
    <section className="py-10">
      <h2 className="mb-5 text-lg font-bold">{title}</h2>
      <div className={`grid gap-4 ${columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        {items.map((b) => (
          <div key={b.title} className="rounded-xl border border-line bg-surface p-5">
            <p className="font-bold">{b.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{b.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingTier({ name, body, highlighted = false }: { name: string; body: string; highlighted?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${highlighted ? "border-2 border-accent" : "border border-line"}`}>
      <p className={`font-bold ${highlighted ? "text-accent-ink" : ""}`}>{name}</p>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>
    </div>
  );
}
