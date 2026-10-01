"use client";
import Link from "next/link";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { CoachCardModel } from "@/lib/coach-discovery";
import { formatPrice } from "@/lib/coach-onboarding";
import { Avatar } from "../social";

/**
 * One coach in a list: scanned in a second, decided on the profile. Photo,
 * name (+ verified), title, where and how, up to three specializations, the
 * cheapest public price, and one action — View profile. No Start coaching and
 * no follow here: both live on /coaches/[slug]. The whole card is the link.
 */
export function CoachCard({ card }: { card: CoachCardModel }) {
  const { t, locale } = useI18n();
  const c = t.coachProfile.discovery.card;
  const d = t.coachProfile.discovery;
  const s = t.coachProfile.services;
  const price = card.startingPrice ? formatPrice(card.startingPrice.cents, card.startingPrice.currency, locale) : null;
  const where = [card.city, ...card.formats.map((f) => (f === "online" ? d.online : d.inPerson))].filter(Boolean).join(" · ");

  return (
    <Link
      href={card.href}
      data-testid="coach-card"
      className="group flex h-full flex-col rounded-3xl bg-surface p-5 outline-none ring-accent/60 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2"
    >
      <div className="flex items-start gap-3.5">
        <Avatar name={card.name} url={card.avatarUrl} size="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate font-display text-[17px] font-bold tracking-tight group-hover:text-accent-ink">{card.name}</span>
            {card.verified ? (
              <span title={c.verified} className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
                ✓<span className="sr-only">{c.verified}</span>
              </span>
            ) : null}
          </p>
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

      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <div className="min-w-0">
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
        </div>
        <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-accent-soft px-3.5 text-[12.5px] font-bold text-accent-ink group-hover:bg-accent group-hover:text-accent-fg">
          {c.viewProfile}
        </span>
      </div>
    </Link>
  );
}
