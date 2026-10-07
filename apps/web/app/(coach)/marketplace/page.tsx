import Link from "next/link";
import { Suspense } from "react";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { SITE_URL } from "@/lib/brand";
import { getProfile } from "@/lib/data";
import { getMyCoachProfile } from "@/lib/coach-profile-data";
import { getCoachMarketplaceAnalytics, getMarketplaceOverview } from "@/lib/marketplace-data";
import { MarketplacePerformance } from "@/components/marketplace-performance";
import { marketplaceState, profileCompleteness } from "@/lib/coach-completeness";
import { formatBookingTime } from "@/lib/booking";
import { MarketplaceTabs } from "@/components/marketplace-tabs";
import { BecomeCoachCard } from "@/components/coach-profile/status";

/**
 * /marketplace — the coach's marketplace in one place (20261108100000): the
 * profile (completeness, state, what to do next), requests, bookings,
 * clients, messages, reviews and services, each a card that leads to the page
 * that already manages it. Two reads in one wave: the coach's own profile
 * (the editor's read, for completeness) and coach_marketplace_overview()
 * (every count, only the caller's rows). No numbers that do not exist.
 */
export default async function MarketplacePage() {
  // performance (20261110120000) rides the same wave
  const [{ t, locale }, me, mine, overview, analytics] = await Promise.all([
    getI18n(), getProfile(), getMyCoachProfile(), getMarketplaceOverview(), getCoachMarketplaceAnalytics(30),
  ]);
  const m = t.coachProfile.marketplace;
  const c = m.cards;

  if (!mine || !overview?.profile) {
    return (
      <div className="mx-auto max-w-3xl">
        <Suspense><MarketplaceTabs /></Suspense>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{m.title}</h1>
        <div className="mt-5"><BecomeCoachCard /></div>
      </div>
    );
  }

  const o = overview;
  const profile = o.profile!;
  const state = marketplaceState(profile.status, mine.missing);
  const completeness = profileCompleteness(mine, {
    hasAvatar: Boolean(me?.avatar_url), availabilityBlocks: o.availability.blocks, bookableServices: o.services?.bookable ?? 0,
  });
  const publicUrl = `${SITE_URL}/coaches/${profile.slug}`;
  const card = "rounded-3xl bg-surface p-5";
  const cardTitle = "flex items-center justify-between gap-2 font-display text-[17px] font-bold tracking-tight";
  const open = "text-[13px] font-semibold text-accent-ink hover:underline";
  const avg = profile.review_avg === null ? null
    : new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(profile.review_avg));
  const next = o.bookings.next ? formatBookingTime(o.bookings.next, locale) : null;
  const primaryAction = state === "draft" ? m.actions.continue : state === "ready" ? m.actions.submit : m.actions.edit;
  const primaryHref = state === "ready" ? "/settings/coach-profile?step=6" : "/settings/coach-profile";

  return (
    <div className="mx-auto max-w-5xl">
      <Suspense><MarketplaceTabs /></Suspense>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{m.title}</h1>
          <p className="mt-1 max-w-[62ch] text-[13.5px] text-ink-soft">{m.hint}</p>
        </div>
        {profile.status === "published" ? (
          <Link href={`/coaches/${profile.slug}`} className="inline-flex h-10 items-center rounded-full bg-surface px-4 text-[13.5px] font-semibold text-ink-soft hover:text-ink">
            {m.viewPublic} ↗
          </Link>
        ) : null}
      </header>

      {/* ---------- the profile: state, completeness, next steps ---------- */}
      <section className={`${card} mt-5`} data-testid="marketplace-profile" data-state={state} data-completeness={completeness.pct}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
              state === "published" ? "bg-accent-soft text-accent-ink" : state === "suspended" ? "bg-risk-soft text-risk" : "bg-warn-soft text-warn"}`}>
              {m.states[state]}
            </span>
            <p className="mt-2 max-w-[60ch] text-[13.5px] text-ink-soft">{m.stateHints[state]}</p>
            {profile.revision_status ? (
              <p className="mt-1.5 text-[13px] font-semibold text-warn" data-testid="marketplace-revision">{m.revisionHint[profile.revision_status]}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="font-display text-[34px] font-extrabold leading-none tracking-tight tabular-nums">{completeness.pct}%</p>
            <p className="mt-1 text-[12px] text-ink-faint">{fill(m.completeness, { pct: completeness.pct })}</p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${completeness.pct}%` }} />
        </div>
        <p className="mt-2 text-[12.5px] text-ink-faint">{m.completenessHint}</p>
        <ul className="mt-4 grid gap-1.5 sm:grid-cols-2" data-testid="marketplace-checklist">
          {completeness.items.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 rounded-2xl bg-bg px-3.5 py-2.5 text-[13.5px]" data-done={item.done}>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                  item.done ? "bg-accent text-accent-fg" : item.required ? "bg-warn-soft text-warn" : "bg-surface text-ink-faint"}`}>
                  {item.done ? "✓" : item.required ? "!" : ""}
                </span>
                <span className={`truncate ${item.done ? "" : "text-ink-soft"}`}>
                  {item.key === "bio" && !item.done && item.earned > 0 ? m.items.bioShort : m.items[item.key]}
                  {item.required && !item.done ? <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wider text-warn">{m.required}</span> : null}
                </span>
              </span>
              {!item.done && profile.status !== "suspended" ? (
                <Link href={item.href} className="shrink-0 text-[12.5px] font-semibold text-accent-ink hover:underline">
                  {fill(m.gain, { n: item.weight - item.earned })} →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={primaryHref} className="inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
            data-testid="marketplace-primary">{primaryAction}</Link>
          <Link href="/settings/coach-profile?step=6" className="inline-flex h-11 items-center rounded-2xl bg-bg px-5 text-sm font-semibold text-ink hover:bg-accent-soft/60">
            {m.actions.preview}
          </Link>
          {profile.verification_status !== "verified" ? (
            <Link href="/settings/coach-profile#verification" className="inline-flex h-11 items-center rounded-2xl bg-bg px-5 text-sm font-semibold text-ink hover:bg-accent-soft/60">
              {m.actions.verify}
            </Link>
          ) : null}
        </div>
        {profile.status === "published" ? (
          <div className="mt-4 rounded-2xl bg-bg px-4 py-3">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{m.shareTitle}</p>
            <p className="mt-1 select-all break-all font-mono text-[13px]" data-testid="marketplace-share-url">{publicUrl}</p>
            <p className="mt-1 text-[12px] text-ink-faint">{m.shareHint}</p>
          </div>
        ) : null}
      </section>

      {/* ---------- the rest, each leading to the page that manages it ---------- */}
      <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <section className={card} data-testid="marketplace-requests">
          <h2 className={cardTitle}>{c.requests}<Link href="/requests" className={open}>{c.open} →</Link></h2>
          {o.requests.pending + o.requests.accepted === 0 ? <p className="mt-2 text-[13.5px] text-ink-soft">{c.requestsNone}</p> : (
            <ul className="mt-2 grid gap-1 text-[13.5px]">
              {o.requests.pending ? <li className="font-semibold text-warn">{fill(c.requestsPending, { n: o.requests.pending })}</li> : null}
              {o.requests.accepted ? <li><Link href="/requests?tab=accepted" className="hover:underline">{fill(c.requestsAccepted, { n: o.requests.accepted })}</Link></li> : null}
            </ul>
          )}
        </section>

        <section className={card} data-testid="marketplace-bookings">
          <h2 className={cardTitle}>{c.bookings}<Link href="/bookings" className={open}>{c.open} →</Link></h2>
          {(o.services?.bookable ?? 0) === 0 && !o.bookings.next ? (
            <p className="mt-2 text-[13.5px] text-ink-soft">{c.bookingsNoBookable} <Link href="/bookings/availability" className={open}>{m.actions.manageAvailability}</Link></p>
          ) : (
            <ul className="mt-2 grid gap-1 text-[13.5px]">
              {next && o.bookings.next ? (
                <li className="font-semibold">{fill(c.bookingsNext, { when: `${next.date} ${next.time}`, client: o.bookings.next.client_name, service: o.bookings.next.service_name })}</li>
              ) : <li className="text-ink-soft">{c.bookingsNone}</li>}
              {o.bookings.pending ? <li className="font-semibold text-warn"><Link href="/bookings?tab=pending" className="hover:underline">{fill(c.bookingsPending, { n: o.bookings.pending })}</Link></li> : null}
              {o.bookings.upcoming ? <li>{fill(c.bookingsUpcoming, { n: o.bookings.upcoming })}</li> : null}
              {o.bookings.needs_outcome ? <li><Link href="/bookings?tab=past" className="hover:underline">{fill(c.bookingsOutcome, { n: o.bookings.needs_outcome })}</Link></li> : null}
            </ul>
          )}
        </section>

        <section className={card} data-testid="marketplace-clients">
          <h2 className={cardTitle}>{c.clients}<Link href="/clients" className={open}>{c.open} →</Link></h2>
          {o.clients.active + o.clients.invited + (o.clients.paused ?? 0) === 0 ? <p className="mt-2 text-[13.5px] text-ink-soft">{c.clientsNone}</p> : (
            <ul className="mt-2 grid gap-1 text-[13.5px]">
              <li className="font-semibold">{fill(c.clientsActive, { n: o.clients.active })}</li>
              {o.clients.paused ? <li className="text-warn">{fill(c.clientsPaused, { n: o.clients.paused })}</li> : null}
              {o.clients.invited ? <li className="text-ink-soft">{fill(c.clientsInvited, { n: o.clients.invited })}</li> : null}
            </ul>
          )}
        </section>

        <section className={card} data-testid="marketplace-messages">
          <h2 className={cardTitle}>{c.messages}<Link href="/messages" className={open}>{c.open} →</Link></h2>
          <p className={`mt-2 text-[13.5px] ${o.messages.unread ? "font-semibold" : "text-ink-soft"}`}>
            {o.messages.unread ? fill(c.messagesUnread, { n: o.messages.unread, c: o.messages.conversations_unread }) : c.messagesNone}
          </p>
        </section>

        <section className={card} data-testid="marketplace-reviews">
          <h2 className={cardTitle}>{c.reviews}<Link href="/reviews" className={open}>{c.open} →</Link></h2>
          {profile.review_count === 0 || avg === null ? <p className="mt-2 text-[13.5px] text-ink-soft">{c.reviewsNone}</p> : (
            <>
              <p className="mt-2 font-semibold">{fill(profile.review_count === 1 ? c.reviewsOne : c.reviewsAvg, { avg, n: profile.review_count })}</p>
              <ul className="mt-2 grid gap-1.5 text-[13px] text-ink-soft">
                {o.reviews.latest.map((r) => (
                  <li key={r.id} className="truncate">{"★".repeat(r.rating)} {r.reviewer_name}{r.body ? ` — ${r.body}` : ""}</li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className={card} data-testid="marketplace-services">
          <h2 className={cardTitle}>{c.services}<Link href="/settings/coach-profile?step=5" className={open}>{c.open} →</Link></h2>
          <p className="mt-2 text-[13.5px] text-ink-soft">
            {(o.services?.active ?? 0) === 0 ? c.servicesNone : fill(c.servicesActive, { n: o.services!.active, b: o.services!.bookable })}
          </p>
        </section>
      </div>
      {/* measured performance: only for a profile people can find, only numbers that exist */}
      {analytics && (profile.status === "published" || profile.status === "hidden") ? (
        <div className="mt-4"><MarketplacePerformance a={analytics} /></div>
      ) : null}
    </div>
  );
}
