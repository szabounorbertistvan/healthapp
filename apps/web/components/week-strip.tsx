"use client";
import Link from "next/link";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { parseDay, shiftDay, weekDaysOf } from "@/lib/week";

/**
 * Day picker for the food diary. The heading is the day being viewed, written
 * out; under it the week as seven pills (weekday letter over the date). The
 * viewed day is the filled pill, today gets a small dot, and a day with
 * something logged carries a short gold bar. Every pill is a link to
 * `/food?day=…`, so it works without JavaScript and with back/forward.
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
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{monthYear}</p>
          <h1 className="text-xl font-bold tracking-tight">{heading}</h1>
        </div>
        <div className="flex items-center gap-1">
          {selected !== today ? (
            <Link
              href={`/food?day=${today}`}
              className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-accent-ink hover:border-accent"
            >
              {w.today}
            </Link>
          ) : null}
          <Link
            href={`/food?day=${shiftDay(selected, -7)}`}
            aria-label={w.prevWeek}
            className="rounded-full px-2 py-1 text-sm font-semibold text-ink-faint hover:bg-surface hover:text-ink"
          >
            ‹
          </Link>
          <Link
            href={`/food?day=${shiftDay(selected, 7)}`}
            aria-label={w.nextWeek}
            className="rounded-full px-2 py-1 text-sm font-semibold text-ink-faint hover:bg-surface hover:text-ink"
          >
            ›
          </Link>
        </div>
      </div>

      <ol className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const date = parseDay(day);
          const isSelected = day === selected;
          const isToday = day === today;
          const hasLog = logged.has(day);
          const pill = isSelected
            ? "bg-accent text-accent-fg shadow-sm"
            : "bg-surface text-ink hover:bg-accent-soft";
          return (
            <li key={day}>
              <Link
                href={`/food?day=${day}`}
                aria-current={isSelected ? "date" : undefined}
                aria-label={fill(w.dayAria, {
                  date: longDate.format(date),
                  status: hasLog ? w.logged : w.empty,
                })}
                className={`relative flex flex-col items-center gap-0.5 rounded-2xl border border-line py-2 transition-colors ${pill}`}
              >
                <span className={`text-[10px] font-semibold uppercase ${isSelected ? "text-accent-fg/70" : "text-ink-faint"}`}>
                  {weekday.format(date)}
                </span>
                <span className="text-base font-bold tabular-nums leading-none">{date.getDate()}</span>
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
