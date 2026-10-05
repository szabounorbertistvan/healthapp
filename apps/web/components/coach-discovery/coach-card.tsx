"use client";
import Link from "next/link";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { CoachCardModel } from "@/lib/coach-discovery";
import { formatPrice } from "@/lib/coach-onboarding";
import { Avatar, FollowButton } from "../social";

/**
 * One coach in a list: scanned in a second, decided on the profile. Photo,
 * name (+ verified), title, where and how, up to three specializations, the
 * cheapest public price — then Follow and View profile. Start coaching lives
 * on /coaches/[slug] only.
 *
 * The whole card opens the profile: the name is the link and stretches over
 * the card (no button may sit inside an <a>), and Follow is lifted above it.
 * Follow is the existing FollowButton for a signed-in reader (the search
 * returns the follow state, 20261026100000), a sign-in link for anyone
 * else, and nothing on your own card.
 */
export function CoachCard({ card, signedIn }: { card: CoachCardModel; signedIn: boolean }) {
  const { t, locale } = useI18n();
  const c = t.coachProfile.discovery.card;
  const d = t.coachProfile.discovery;
  const p = t.coachProfile.publicPage;
  const s = t.coachProfile.services;
  const price = card.startingPrice ? formatPrice(card.startingPrice.cents, card.startingPrice.currency, locale) : null;
  const where = [card.city, ...card.formats.map((f) => (f === "online" ? d.online : d.inPerson))].filter(Boolean).join(" · ");

  const follow = card.follow ? (
    <FollowButton userId={card.follow.userId} following={card.follow.following} followsMe={card.follow.followsMe} compact />
  ) : !signedIn ? (
    <Link
      href={`/login?${new URLSearchParams({ next: card.href })}`} title={p.signInToFollow}
      className="inline-flex h-9 min-w-[104px] items-center justify-center rounded-full border border-line px-3.5 text-[12.5px] font-semibold text-ink hover:bg-bg"
    >
      {p.follow}
    </Link>
  ) : null;

  return (
    <article
      data-testid="coach-card"
      className="group relative flex h-full flex-col rounded-3xl bg-surface p-5 ring-accent/60 transition hover:-translate-y-0.5 hover:shadow-lg focus-within:ring-2"
    >
      <div className="flex items-start gap-3.5">
        <Avatar name={card.name} url={card.avatarUrl} size="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5">
            <Link
              href={card.href}
              className="truncate font-display text-[17px] font-bold tracking-tight outline-none after:absolute after:inset-0 after:rounded-3xl group-hover:text-accent-ink"
            >
              {card.name}
            </Link>
            {card.verified ? (
              <span title={c.verified} className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
                ✓<span className="sr-only">{c.verified}</span>
              </span>
            ) : null}
          </h3>
          {card.headline ? <p className="mt-0.5 line-clamp-2 text-[13.5px] text-ink-soft">{card.headline}</p> : null}
        </div>
      </div>

      {where || card.years ? (
        <p className="mt-3 text-[12.5px] text-ink-faint">
          {[where, card.years ? fill(c.years, { n: card.years }) : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {card.specializations.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {card.specializations.map((name) => (
            <li key={name} className="rounded-full bg-bg px-2.5 py-1 text-[12px] font-semibold text-ink-soft">{name}</li>
          ))}
          {card.moreSpecializations > 0 ? (
            <li className="rounded-full px-1.5 py-1 text-[12px] font-semibold text-ink-faint">{fill(c.more, { n: card.moreSpecializations })}</li>
          ) : null}
        </ul>
      ) : null}

      <div className="mt-auto pt-5">
        <p className="font-display text-[15px] font-extrabold tracking-tight">
          {price ? (
            <>
              {fill(c.from, { price })}
              {s.unitShort[card.startingPrice!.unit] ? (
                <span className="ml-1 text-[12.5px] font-semibold text-ink-soft">{s.unitShort[card.startingPrice!.unit]}</span>
              ) : null}
            </>
          ) : (
            <span className="text-[13px] font-semibold text-ink-soft">{c.priceOnRequest}</span>
          )}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-faint">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${card.accepting ? "bg-accent" : "bg-ink-faint"}`} />
          {card.accepting ? c.accepting : c.notAccepting}
          <span aria-hidden>·</span>
          {fill(c.followers, { n: card.followers })}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-4">
          {/* above the stretched link, so a tap here follows instead of opening the profile */}
          <div className="relative z-10">{follow}</div>
          <span aria-hidden className="inline-flex h-9 shrink-0 items-center rounded-full bg-accent-soft px-3.5 text-[12.5px] font-bold text-accent-ink group-hover:bg-accent group-hover:text-accent-fg">
            {c.viewProfile} →
          </span>
        </div>
      </div>
    </article>
  );
}
