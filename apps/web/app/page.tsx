import Link from "next/link";
import { isDemo } from "@/lib/supabase/server";
import { APP_NAME, APP_INITIAL } from "@/lib/brand";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { LanguageSelector } from "@/components/language-selector";

export default async function LandingPage() {
  const { t } = await getI18n();
  const l = t.landing;
  return (
    <main className="mx-auto max-w-4xl px-6 pb-20">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-black text-white">{APP_INITIAL}</span>
          <span className="text-lg font-extrabold tracking-tight">{APP_NAME}</span>
        </div>
        <nav className="flex items-center gap-3">
          <LanguageSelector />
          <Link href="/login" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            {l.signIn}
          </Link>
        </nav>
      </header>

      <section className="py-14 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent-ink">
          {l.tagline}
        </p>
        <h1 className="mx-auto max-w-2xl text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">
          {l.heroTitle}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-ink-soft">
          {fill(l.heroBody, { app: APP_NAME })}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className="rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:opacity-90">
            {l.startFree}
          </Link>
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

      <footer className="pt-10 text-center text-xs text-ink-faint">
        <Link href="/privacy" className="hover:underline">{t.common.legal.privacy}</Link>
        {" · "}
        <Link href="/terms" className="hover:underline">{t.common.legal.terms}</Link>
        {" · "}
        {APP_NAME} · {t.common.legal.foodData}
      </footer>
    </main>
  );
}

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
