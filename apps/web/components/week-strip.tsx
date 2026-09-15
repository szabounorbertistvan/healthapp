"use client";
import Link from "next/link";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay, shiftDay, weekDaysOf } from "@/lib/week";
import { NavIcon } from "./client-nav";

/**
 * Day picker for the food diary. The heading is the day being viewed, written
 * out; under it the week as seven cells (weekday letter over the date) across
 * the full width. The viewed day is the filled cell, today gets a small dot,
 * and a day with something logged carries a short gold bar. Every cell is a
 * link to `/food?day=…`, so it works without JavaScript and with back/forward.
 */
export function WeekStrip({
  selected,
  today,
  loggedDays,
}: {
  selected: string;
  /** Server-side today, so the mark never disagrees with what the page loaded. */
  today: string;
  loggedDays: string[];
}) {
  const { t, locale } = useI18n();
  const w = t.clientWidgets.weekStrip;
  const days = weekDaysOf(selected);
  const logged = new Set(loggedDays);
  const longDate = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  // "sâmbătă, 5 septembrie" → sentence case; Romanian keeps month names lowercase.
  const raw = longDate.format(parseDay(selected));
  const heading = raw.charAt(0).toUpperCase() + raw.slice(1);
  const monthYear = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(parseDay(selected));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{monthYear}</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">{heading}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          {selected !== today ? (
            <Link
              href={`/food?day=${today}`}
              className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-accent-ink"
            >
              {w.today}
            </Link>
          ) : null}
          <Link
            href={`/food?day=${shiftDay(selected, -7)}`}
            aria-label={w.prevWeek}
            className="grid h-9 w-9 place-items-center rounded-full bg-surface text-ink-soft hover:text-ink"
          >
            <NavIcon d="m15 6-6 6 6 6" className="h-[15px] w-[15px] [stroke-width:2.2]" />
          </Link>
          <Link
            href={`/food?day=${shiftDay(selected, 7)}`}
            aria-label={w.nextWeek}
            className="grid h-9 w-9 place-items-center rounded-full bg-surface text-ink-soft hover:text-ink"
          >
            <NavIcon d="m9 6 6 6-6 6" className="h-[15px] w-[15px] [stroke-width:2.2]" />
          </Link>
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-7 gap-1.5 sm:gap-2.5">
        {days.map((day) => {
          const date = parseDay(day);
          const isSelected = day === selected;
          const isToday = day === today;
          const hasLog = logged.has(day);
          return (
            <li key={day}>
              <Link
                href={`/food?day=${day}`}
                aria-current={isSelected ? "date" : undefined}
                aria-label={fill(w.dayAria, {
                  date: longDate.format(date),
                  status: hasLog ? w.logged : w.empty,
                })}
                className={`flex flex-col items-center gap-0.5 rounded-2xl py-2.5 transition-colors sm:py-3 ${
                  isSelected ? "bg-accent text-accent-fg" : "bg-surface text-ink hover:bg-accent-soft"
                }`}
              >
                <span className={`text-[10px] font-semibold uppercase ${isSelected ? "text-accent-fg/70" : "text-ink-faint"}`}>
                  {weekday.format(date)}
                </span>
                <span className="text-[15px] font-bold tabular-nums leading-none sm:text-[17px]">{date.getDate()}</span>
                {/* logged marker: a short bar; today: a dot. Both fit under the number. */}
                <span
                  aria-hidden
                  className={`mt-1 h-1 rounded-full ${
                    hasLog
                      ? `w-4 ${isSelected ? "bg-accent-fg/60" : "bg-accent"}`
                      : isToday
                        ? `w-1 ${isSelected ? "bg-accent-fg/60" : "bg-accent"}`
                        : "w-1 bg-transparent"
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
