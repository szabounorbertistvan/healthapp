import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import type { CoachMarketplaceAnalytics } from "@/lib/marketplace-data";

/**
 * The coach's marketplace performance (20261110120000) on /marketplace.
 * Business numbers (saves, requests, bookings, rating) are counts of real
 * rows; views, clicks and sign-ups come from the first-party event log and
 * are shown only once it has started, with the date it started when that is
 * inside the window — never a placeholder, never a conversion rate built on
 * a partial window.
 */
export async function MarketplacePerformance({ a }: { a: CoachMarketplaceAnalytics }) {
  const { t, locale } = await getI18n();
  const p = t.coachProfile.marketplace.performance;
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "long" });
  const windowStart = Date.now() - a.window_days * 86_400_000;
  const since = a.tracking_since ? new Date(a.tracking_since) : null;
  const partial = since && since.getTime() > windowStart;
  const avg = a.review_avg === null ? null
    : new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(a.review_avg));
  const sourceName = (s: string) => s === "direct" ? p.direct : s === "internal" ? p.internal : s === "referral" ? p.referral
    : s.charAt(0).toUpperCase() + s.slice(1);

  const tile = "rounded-2xl bg-bg px-4 py-3";
  const value = "font-display text-[22px] font-extrabold tabular-nums tracking-tight";
  const label = "text-[12.5px] font-semibold text-ink-soft";
  const sub = "mt-0.5 text-[12px] text-ink-faint";

  return (
    <section className="rounded-3xl bg-surface p-5" data-testid="marketplace-performance">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[17px] font-bold tracking-tight">{p.title}</h2>
        <p className="text-[12.5px] text-ink-faint">
          {fill(p.window, { n: a.window_days })}
          {partial && since ? ` · ${fill(p.since, { date: df.format(since) })}` : ""}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {since ? (
          <>
            <div className={tile} data-testid="perf-views" title={p.viewsHint}>
              <p className={label}>{p.views}</p><p className={value}>{nf.format(a.profile_views)}</p>
            </div>
            <div className={tile} data-testid="perf-contact-clicks">
              <p className={label}>{p.contactClicks}</p><p className={value}>{nf.format(a.contact_clicks)}</p>
            </div>
          </>
        ) : null}
        <div className={tile} data-testid="perf-saves">
          <p className={label}>{p.saves}</p><p className={value}>{nf.format(a.saves)}</p>
          <p className={sub}>{fill(p.savesTotal, { n: nf.format(a.saves_total) })}</p>
        </div>
        <div className={tile} data-testid="perf-requests">
          <p className={label}>{p.requests}</p><p className={value}>{nf.format(a.requests)}</p>
          <p className={sub}>{fill(p.requestsAccepted, { n: nf.format(a.requests_accepted) })}</p>
        </div>
        <div className={tile} data-testid="perf-bookings">
          <p className={label}>{p.bookings}</p><p className={value}>{nf.format(a.bookings)}</p>
          <p className={sub}>{fill(p.bookingsCompleted, { n: nf.format(a.bookings_completed) })}</p>
        </div>
        <div className={tile} data-testid="perf-rating">
          <p className={label}>{p.rating}</p>
          {a.review_count > 0 && avg ? <p className={value}>{avg} ★</p> : <p className="mt-1 text-[13px] text-ink-faint">{p.noReviews}</p>}
          {a.review_count > 0 ? <p className={sub}>{nf.format(a.review_count)}</p> : null}
        </div>
        {since && a.signups > 0 ? (
          <div className={tile} data-testid="perf-signups">
            <p className={label}>{p.signups}</p><p className={value}>{nf.format(a.signups)}</p>
          </div>
        ) : null}
        {/* 20261111120000 — shown once there is something to show */}
        {since && (a.service_views ?? 0) > 0 ? (
          <div className={tile} data-testid="perf-service-views">
            <p className={label}>{p.serviceViews}</p><p className={value}>{nf.format(a.service_views ?? 0)}</p>
          </div>
        ) : null}
        {since && (a.shares ?? 0) > 0 ? (
          <div className={tile} data-testid="perf-shares">
            <p className={label}>{p.shares}</p><p className={value}>{nf.format(a.shares ?? 0)}</p>
          </div>
        ) : null}
        {since && (a.login_walls ?? 0) > 0 ? (
          <div className={tile} data-testid="perf-login-walls">
            <p className={label}>{p.loginWalls}</p><p className={value}>{nf.format(a.login_walls ?? 0)}</p>
          </div>
        ) : null}
      </div>

      {!since ? <p className="mt-3 text-[13px] text-ink-soft">{p.notYet}</p> : null}
      {since && a.sources.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{p.sources}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5" data-testid="perf-sources">
            {a.sources.map((s) => (
              <li key={s.source} className="rounded-full bg-bg px-3 py-1 text-[12.5px]">
                {sourceName(s.source)} <span className="font-semibold tabular-nums">{nf.format(s.n)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-[11.5px] text-ink-faint">{p.privacy}</p>
    </section>
  );
}
