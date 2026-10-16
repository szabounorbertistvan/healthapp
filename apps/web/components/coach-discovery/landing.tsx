import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { fill, type Dictionary } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { searchCoaches } from "@/lib/coach-profile-data";
import { EMPTY_QUERY, discoverySearch, toCoachCard, type CoachCardModel, type DiscoveryQuery } from "@/lib/coach-discovery";
import { ratingLabel } from "@/lib/coach-review";
import { Avatar } from "../social-chrome";
import { VerifiedBadge } from "./verified-badge";

/** A short list, not a directory: the landing page points at /coaches, it does not replace it. */
const PICKS = 3;

/**
 * Coach Discovery on the landing page: the promise on the left, the first
 * coaches of the directory's own "recommended" order on the right — the same
 * search_coaches() call and toCoachCard() model as the Discovery Home, so the
 * landing page never ranks, picks or invents a coach of its own. Nobody
 * taking clients falls back to everyone published, as the Discovery Home
 * does; nobody published at all (or the search failing) shows the three
 * steps instead of empty cards. One RPC, streamed under its own Suspense
 * boundary so the hero never waits for it.
 */
export async function LandingCoachDiscovery({ coachCtaHref }: { coachCtaHref: string }) {
  const { t, locale } = await getI18n();
  const l = t.landing.coaches;
  const h = t.coachProfile.discovery.home;

  const picks = await loadPicks();
  const cards = picks?.result.items.map((row) => toCoachCard(row, locale)) ?? [];
  const total = picks?.result.total ?? 0;
  const count = !picks || total === 0 ? null
    : picks.accepting ? fill(total === 1 ? l.acceptingOne : l.accepting, { n: total })
    : fill(total === 1 ? l.publishedOne : l.published, { n: total, app: APP_NAME });

  return (
    <Shell t={t} coachCtaHref={coachCtaHref}>
      {cards.length > 0 ? (
        <div data-testid="landing-coaches-picks">
          <ul aria-label={fill(l.picks, { app: APP_NAME })} className="space-y-2.5 sm:space-y-3">
            {cards.map((card) => (
              <li key={card.href}>
                <PreviewCard card={card} t={t} locale={locale} />
              </li>
            ))}
          </ul>
          {count ? (
            <p className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[13px]">
              <span className="flex items-center gap-2 text-ink-soft">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                {count}
              </span>
              <Link href={`/coaches${discoverySearch(picks!.seeAll)}`}
                className="rounded font-semibold text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">
                {l.seeAll} →
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        // no coach to show yet: what the directory does, never a made-up profile
        <ol className="space-y-2.5 sm:space-y-3" data-testid="landing-coaches-steps">
          {h.steps.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-2xl bg-bg p-4 sm:p-5">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent font-display text-[14px] font-extrabold text-accent-fg">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="font-display text-[15.5px] font-bold">{step.title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}

/**
 * The copy and calls to action at once; the coach rows as pulse bars of a
 * real row's height (name, headline, meta, chips) and the count line under
 * them, so the section barely moves when the coaches arrive.
 */
export function LandingCoachDiscoverySkeleton({ t, coachCtaHref }: { t: Dictionary; coachCtaHref: string }) {
  const bar = "block animate-pulse rounded-full bg-surface motion-reduce:animate-none";
  return (
    <Shell t={t} coachCtaHref={coachCtaHref}>
      <div aria-busy="true" data-testid="landing-coaches-skeleton">
        <ul className="space-y-2.5 sm:space-y-3">
          {Array.from({ length: PICKS }, (_, i) => (
            <li key={i} className="flex items-center gap-4 rounded-2xl bg-bg p-4 sm:p-5">
              <span className={`${bar} h-14 w-14 shrink-0 sm:h-16 sm:w-16`} />
              <span className="flex-1">
                <span className={`${bar} h-4 w-2/5`} />
                <span className={`${bar} mt-2 h-3 w-3/4`} />
                <span className={`${bar} mt-2 h-2.5 w-1/2`} />
                <span className={`${bar} mt-2.5 h-5 w-28`} />
              </span>
            </li>
          ))}
        </ul>
        <span className={`${bar} mx-1 mt-4 h-3.5 w-48`} />
      </div>
    </Shell>
  );
}

async function loadPicks(): Promise<{ result: Awaited<ReturnType<typeof searchCoaches>>; accepting: boolean; seeAll: DiscoveryQuery } | null> {
  try {
    const first = await searchCoaches(EMPTY_QUERY, PICKS);
    if (first.total > 0) return { result: first, accepting: true, seeAll: { ...EMPTY_QUERY, browse: true } };
    const all = { ...EMPTY_QUERY, accepting: false };
    return { result: await searchCoaches(all, PICKS), accepting: false, seeAll: { ...all, browse: true } };
  } catch (error) {
    // The landing page is the front door: a directory that cannot answer
    // must not take it down. The section falls back to the steps.
    console.error(`landing coaches: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function Shell({ t, coachCtaHref, children }: { t: Dictionary; coachCtaHref: string; children: React.ReactNode }) {
  const l = t.landing.coaches;
  const h = t.coachProfile.discovery.home;

  return (
    <section
      aria-labelledby="landing-coaches"
      data-testid="landing-coaches"
      className="relative mt-9 overflow-hidden rounded-[28px] bg-surface p-6 sm:mt-16 sm:p-10 lg:p-12"
    >
      {/* the Discovery Home's own warm light, low and in the corner */}
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-accent-soft opacity-60 blur-3xl sm:h-96 sm:w-96" />

      {/* Phones and tablets read copy → coaches → the coach invitation, so the
          second audience never sits between the main button and the coaches
          it promises. Desktop puts the invitation back under the copy. */}
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[1fr_auto] lg:gap-x-14 lg:gap-y-8">
        <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
          <p className="flex items-center gap-3 font-display text-xs font-bold uppercase tracking-[0.28em] text-accent-ink">
            <span className="h-px w-8 bg-accent" aria-hidden />
            {l.eyebrow}
          </p>
          <h2 id="landing-coaches" className="mt-4 max-w-[18ch] text-balance font-display text-[30px] font-extrabold leading-[1.06] tracking-tight sm:text-[42px]">
            {l.title}
          </h2>
          <p className="mt-4 max-w-[52ch] leading-relaxed text-ink-soft sm:text-[16px]">{l.body}</p>
          <div className="mt-6 sm:mt-7">
            <Link
              href="/coaches"
              data-testid="landing-coaches-cta"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 font-display font-bold text-accent-fg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:w-auto"
            >
              {l.cta}
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">{children}</div>

        {/* the second audience, quieter: a coach is the supply the directory needs */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-5 text-[13.5px] text-ink-soft lg:col-start-1 lg:row-start-2 lg:self-start">
          <span className="font-semibold text-ink">{h.forCoaches}</span>
          <Link href={coachCtaHref} data-testid="landing-coaches-for-coaches"
            className="rounded font-semibold text-accent-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">
            {h.forCoachesCta} →
          </Link>
        </p>
      </div>
    </section>
  );
}

/**
 * One coach, as a row: photo, name (+ verified), headline, where and how, two
 * specializations, the rating when there are published reviews. The name is
 * the link and stretches over the row — the same pattern as CoachCard, minus
 * Follow and Save, which belong to the directory.
 */
function PreviewCard({ card, t, locale }: { card: CoachCardModel; t: Dictionary; locale: "en" | "ro" }) {
  const d = t.coachProfile.discovery;
  const c = d.card;
  const where = [card.city, ...card.formats.map((f) => (f === "online" ? d.online : d.inPerson))].filter(Boolean).join(" · ");
  const specs = card.specializations.slice(0, 2);
  const more = card.moreSpecializations + (card.specializations.length - specs.length);
  const rating = ratingLabel(card.rating, { one: c.reviewOne, many: c.reviewMany }, locale);

  return (
    <article
      data-testid="landing-coach-card"
      className="group relative flex items-center gap-4 rounded-2xl bg-bg p-4 ring-accent/60 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-within:ring-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-5"
    >
      <Avatar name={card.name} url={card.avatarUrl} size="h-14 w-14 sm:h-16 sm:w-16" initialClassName="font-display text-xl sm:text-2xl" />
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5">
          <Link
            href={card.href}
            className="truncate font-display text-[16px] font-bold tracking-tight outline-none after:absolute after:inset-0 after:rounded-2xl group-hover:text-accent-ink sm:text-[17px]"
          >
            {card.name}
          </Link>
          <VerifiedBadge verified={card.verified} />
        </h3>
        {card.headline ? <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-soft sm:line-clamp-1">{card.headline}</p> : null}
        {where || rating ? (
          <p className="mt-1 text-[12px] text-ink-faint">
            {where}
            {where && rating ? <span aria-hidden> · </span> : null}
            {/* published reviews only; its own nowrap run, so a narrow card wraps before it, never through it */}
            {rating ? <span className="whitespace-nowrap font-semibold text-ink-soft">{rating}</span> : null}
          </p>
        ) : null}
        {specs.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {specs.map((name) => {
              // the coach's own starred focus, from the database — never guessed from the order
              const primary = name === card.primarySpecialization;
              return (
                <li key={name} className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${primary ? "bg-accent-soft text-accent-ink" : "bg-surface text-ink-soft"}`}>
                  {primary ? <span className="sr-only">{t.coachProfile.taxonomy.primaryBadge}: </span> : null}
                  {name}
                </li>
              );
            })}
            {more > 0 ? <li className="px-1 py-0.5 text-[11.5px] font-semibold text-ink-faint">{fill(c.more, { n: more })}</li> : null}
          </ul>
        ) : null}
      </div>
      <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink transition group-hover:bg-accent group-hover:text-accent-fg min-[420px]:flex">
        →
      </span>
    </article>
  );
}
