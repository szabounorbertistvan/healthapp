import Image from "next/image";
import Link from "next/link";
import { getProfile } from "@/lib/data";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo, LogoMark, Wordmark } from "@/components/logo";
import { LoginModal } from "@/components/login-modal";

/**
 * The public page. The brand athletes carry it: the pair beside the promise,
 * then the client and the coach next to what each one gets, each figure turned
 * toward its own copy. Cutouts with a transparent background stand directly on
 * the page — no box, no glow — and the dark studio frames run as one band.
 */
export default async function LandingPage() {
  const [{ t }, profile] = await Promise.all([getI18n(), getProfile()]);
  const l = t.landing;
  // Signed-in visitors (they got here via the logo) get a way back into the app.
  const appHref = profile ? (profile.role === "client" ? "/today" : "/dashboard") : null;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-7">
      <header className="flex items-center justify-end gap-4 py-4 sm:py-[18px]">
        <nav className="flex items-center gap-2 sm:gap-2.5">
          <LanguageSelector />
          <ThemeToggle />
          {appHref ? (
            <Link
              href={appHref}
              className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[13.5px] font-semibold text-accent-fg hover:opacity-90 sm:px-[18px]"
            >
              {l.openApp}
            </Link>
          ) : (
            <LoginModal
              label={l.signIn}
              className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[13.5px] font-semibold text-accent-fg hover:opacity-90 sm:px-[18px]"
            />
          )}
        </nav>
      </header>

      {/* Hero: the promise on the left, the pair on the right, standing on the section's floor. */}
      <section className="grid items-end gap-0 pt-2 sm:min-h-[520px] sm:grid-cols-[minmax(0,1fr)_minmax(0,440px)] sm:gap-10 sm:pt-5">
        <div className="pb-6 sm:pb-10">
          <Link href="/" aria-label={APP_NAME} className="inline-flex items-center gap-3 sm:gap-4">
            <LogoMark className="h-14 w-14 sm:h-[72px] sm:w-[72px]" />
            <Wordmark className="h-6 sm:h-8" />
          </Link>
          <p className="mt-5 flex items-center gap-3 font-display text-xs font-bold uppercase tracking-[0.28em] text-accent-ink">
            <span className="h-px w-8 bg-accent" aria-hidden />
            {APP_TAGLINE}
          </p>
          <h1 className="mt-4 text-balance font-display text-[34px] font-extrabold leading-[1.04] tracking-tight sm:text-[54px]">
            {l.heroTitle}
          </h1>
          <p className="mt-4 max-w-[56ch] leading-relaxed text-ink-soft sm:mt-[18px] sm:text-[17px]">
            {fill(l.heroBody, { app: APP_NAME })}
          </p>
          <div className="mt-6 flex flex-wrap gap-3 sm:mt-7">
            {appHref ? (
              <Link
                href={appHref}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl bg-accent px-6 font-display font-bold text-accent-fg hover:opacity-90 sm:flex-none"
              >
                {l.openApp}
              </Link>
            ) : (
              <>
                <LoginModal
                  label={l.startFree}
                  mode="signup"
                  className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl bg-accent px-6 font-display font-bold text-accent-fg hover:opacity-90 sm:flex-none"
                />
                <LoginModal
                  label={l.signIn}
                  className="inline-flex h-12 flex-1 items-center justify-center rounded-2xl bg-surface px-6 font-display font-bold text-ink-soft hover:text-ink sm:flex-none"
                />
              </>
            )}
          </div>
        </div>
        <div className="flex items-end justify-center">
          <Image
            src="/brand/athletes/hero.webp"
            alt=""
            aria-hidden
            width={597}
            height={1200}
            priority
            sizes="(min-width: 640px) 27rem, 90vw"
            className="h-auto max-h-[360px] w-auto max-w-full select-none sm:max-h-[540px]"
          />
        </div>
      </section>

      {/* The four pillars from the logo strip: dumbbell · clipboard · bowl · chart. */}
      <section className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3.5">
        {l.pillars.map((p, i) => (
          <div
            key={p.title}
            className="flex min-h-[172px] flex-col rounded-3xl bg-surface p-5 transition hover:bg-accent-soft/40 sm:min-h-[210px] sm:p-7"
          >
            <div className="flex items-center gap-3">
              <span className="text-accent-ink">{PILLAR_ICONS[i]}</span>
              <p className="min-w-0 font-display text-[18px] font-bold tracking-tight sm:text-xl">{p.title}</p>
            </div>
            <span aria-hidden className="mt-4 block h-px w-7 bg-accent" />
            <p className="mt-3.5 text-[13.5px] leading-relaxed text-ink-soft sm:text-sm">{p.body}</p>
          </div>
        ))}
      </section>

      {/* A breath between the promise and the detail: three studio frames. */}
      <section className="mt-9 grid gap-3.5 sm:mt-16 sm:grid-cols-3">
        {BAND.map((name, i) => (
          <figure
            key={name}
            className={`m-0 aspect-[3/2] overflow-hidden rounded-3xl bg-[#0b0b0d] ${i === 2 ? "hidden sm:block" : ""}`}
          >
            <Image
              src={`/brand/athletes/hero/${name}.webp`}
              alt=""
              aria-hidden
              width={1200}
              height={800}
              sizes="(min-width: 640px) 26rem, 100vw"
              className="h-full w-full object-cover"
            />
          </figure>
        ))}
      </section>

      <Audience
        title={l.forYou}
        items={l.clientBenefits}
        columns={2}
        figure={{ src: "/brand/athletes/client.webp", width: 430, height: 1200 }}
        side="left"
      />
      <Audience
        title={l.forCoaches}
        items={l.coachBenefits}
        columns={3}
        figure={{ src: "/brand/athletes/coach.webp", width: 699, height: 1200 }}
        side="right"
      />

      <section className="mt-11 text-center sm:mt-[72px]">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{l.pricingTitle}</h2>
        <div className="mt-6 grid gap-3.5 text-left sm:grid-cols-3">
          <PricingTier name={l.pricingFree} body={l.pricingFreeBody} />
          <PricingTier name={l.pricingPremium} body={l.pricingPremiumBody} highlighted />
          <PricingTier name={l.pricingCoach} body={l.pricingCoachBody} />
        </div>
        <p className="mt-5 text-[12.5px] text-ink-faint">{l.pricingFootnote}</p>
      </section>

      <footer className="mt-11 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-7 text-[12.5px] text-ink-faint sm:mt-[72px]">
        <Logo size="sm" />
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/privacy" className="hover:text-ink">{t.common.legal.privacy}</Link>
          <Link href="/terms" className="hover:text-ink">{t.common.legal.terms}</Link>
          <span>{t.common.legal.foodData}</span>
        </p>
      </footer>
    </main>
  );
}

/** The three studio frames under the pillars; the third is desktop-only. */
const BAND = ["chest", "legs", "back"] as const;

const ICON = "h-8 w-8 shrink-0 sm:h-9 sm:w-9";
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

/**
 * One audience: its figure on the side the copy is not on, so the athlete
 * faces the text. On a phone the figure goes first and the cards stack.
 */
function Audience({
  title,
  items,
  columns,
  figure,
  side,
}: {
  title: string;
  items: readonly { title: string; body: string }[];
  columns: 2 | 3 | 4;
  /** Omit to run the section full width, with no athlete beside it. */
  figure?: { src: string; width: number; height: number };
  side?: "left" | "right";
}) {
  const image = figure ? (
    <div className={`flex items-end justify-center ${side === "left" ? "" : "sm:order-last"}`}>
      <Image
        src={figure.src}
        alt=""
        aria-hidden
        width={figure.width}
        height={figure.height}
        sizes="(min-width: 640px) 21rem, 60vw"
        className="h-auto max-h-[280px] w-auto max-w-full select-none sm:max-h-[400px]"
      />
    </div>
  ) : null;
  return (
    <section
      className={`mt-11 grid items-end gap-[18px] sm:mt-[72px] sm:gap-11 ${
        !figure ? "" : side === "left" ? "sm:grid-cols-[340px_minmax(0,1fr)]" : "sm:grid-cols-[minmax(0,1fr)_340px]"
      }`}
    >
      {image}
      <div className={`pb-2.5 ${figure && side === "right" ? "sm:order-first" : ""}`}>
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
        <div
          className={`mt-5 grid gap-3.5 ${
            columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"
          }`}
        >
          {items.map((b) => (
            <div key={b.title} className="rounded-[22px] bg-surface p-5">
              <p className="font-display text-base font-bold">{b.title}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{b.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingTier({ name, body, highlighted = false }: { name: string; body: string; highlighted?: boolean }) {
  return (
    <div className={`rounded-3xl p-6 ${highlighted ? "bg-accent-soft" : "bg-surface"}`}>
      <p className={`font-display text-[19px] font-extrabold ${highlighted ? "text-accent-ink" : ""}`}>{name}</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}
