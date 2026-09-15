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

      {/* The two audiences as one band rather than two stacked sections: each
          half keeps its own list, and its athlete stands in the outer corner
          with their feet on the card's edge, so the pair brackets the copy. */}
      <section className="mt-11 grid overflow-hidden rounded-3xl bg-surface sm:mt-[72px] md:grid-cols-2">
        <Audience
          title={l.forYou}
          items={l.clientBenefits}
          figure={{ src: "/brand/athletes/client.webp", width: 430, height: 1200 }}
          side="left"
        />
        <Audience
          title={l.forCoaches}
          items={l.coachBenefits}
          figure={{ src: "/brand/athletes/coach.webp", width: 699, height: 1200 }}
          side="right"
          divider
        />
      </section>

      <section className="mt-11 text-center sm:mt-[72px]">
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{l.pricingTitle}</h2>
        <div className="mt-6 grid gap-3.5 text-left sm:grid-cols-3">
          <PricingTier name={l.pricingFree} body={l.pricingFreeBody} icon={TIER_ICONS[0]} />
          <PricingTier name={l.pricingPremium} body={l.pricingPremiumBody} icon={TIER_ICONS[1]} highlighted />
          <PricingTier name={l.pricingCoach} body={l.pricingCoachBody} icon={TIER_ICONS[2]} />
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
 * One half of the audience band: the heading, its promises as plain rows (they
 * are inside a card already — a card inside a card reads as noise), and the
 * athlete standing in the outer corner. The figures are decorative, so a phone
 * drops them and keeps the words.
 */
function Audience({
  title,
  items,
  figure,
  side,
  divider = false,
}: {
  title: string;
  items: readonly { title: string; body: string }[];
  figure: { src: string; width: number; height: number };
  side: "left" | "right";
  /** The second half carries the hairline, so the two never double it. */
  divider?: boolean;
}) {
  return (
    <div
      className={`relative flex min-h-[380px] flex-col p-6 sm:min-h-[440px] sm:p-8 ${
        divider ? "border-t border-line/60 md:border-l md:border-t-0" : ""
      }`}
    >
      {/* On the right half the heading sits at the outer edge too, so the two
          titles bookend the band instead of both hugging the middle. */}
      <h2
        className={`font-display text-2xl font-extrabold tracking-tight sm:text-[26px] ${
          side === "right" ? "sm:text-right" : ""
        }`}
      >
        {title}
      </h2>
      <ul
        className={`mt-5 space-y-4 sm:space-y-5 ${
          side === "left" ? "sm:pl-[34%] lg:pl-[38%]" : "sm:pr-[34%] lg:pr-[38%]"
        }`}
      >
        {items.map((b) => (
          <li key={b.title}>
            <p className="font-display text-[15px] font-bold">{b.title}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{b.body}</p>
          </li>
        ))}
      </ul>
      <Image
        src={figure.src}
        alt=""
        aria-hidden
        width={figure.width}
        height={figure.height}
        sizes="18rem"
        className={`pointer-events-none absolute bottom-0 hidden h-auto max-h-[340px] w-auto select-none sm:block lg:max-h-[400px] ${
          side === "left" ? "left-2 lg:left-4" : "right-2 lg:right-4"
        }`}
      />
    </div>
  );
}

const TIER_ICON = "h-6 w-6";
const TIER_ICONS = [
  // check in a circle - everything you get without paying
  <svg key="free" viewBox="0 0 24 24" className={TIER_ICON} {...STROKE} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.4 12.2 2.4 2.4 4.8-5.1" />
  </svg>,
  // star - the upgrade
  <svg key="premium" viewBox="0 0 24 24" className={TIER_ICON} {...STROKE} aria-hidden>
    <path d="m12 3.6 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.85 1-5.85L3.5 9.75l5.9-.85z" />
  </svg>,
  // two people - the coach and their roster
  <svg key="coach" viewBox="0 0 24 24" className={TIER_ICON} {...STROKE} aria-hidden>
    <circle cx="9.2" cy="8" r="3.2" />
    <path d="M3.5 19.5c0-3.1 2.6-5.2 5.7-5.2s5.7 2.1 5.7 5.2" />
    <path d="M16.4 5.9a3.1 3.1 0 0 1 0 5.9M17.4 14.6c1.9.7 3.1 2.4 3.1 4.6" />
  </svg>,
];

/**
 * One price plan. The icon tile, the hairline and the type scale are the
 * pillars', so the two rows of cards read as the same family; the middle plan
 * is lifted by its ground alone, no border and no badge.
 */
function PricingTier({
  name,
  body,
  icon,
  highlighted = false,
}: {
  name: string;
  body: string;
  icon: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-3xl p-6 transition sm:p-7 ${
        highlighted ? "bg-accent-soft" : "bg-surface hover:bg-accent-soft/40"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-accent-ink ${
            highlighted ? "bg-surface" : "bg-bg"
          }`}
        >
          {icon}
        </span>
        <p className={`min-w-0 font-display text-[19px] font-extrabold ${highlighted ? "text-accent-ink" : ""}`}>
          {name}
        </p>
      </div>
      <span aria-hidden className="mt-4 block h-px w-7 bg-accent" />
      <p className="mt-3.5 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}
