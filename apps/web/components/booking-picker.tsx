"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zonedDate } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { BUTTON, FIELD, LABEL } from "@/lib/form-classes";
import { zoneLabel, type BookingErrorCode, type Slot } from "@/lib/booking";
import { bookService } from "@/app/booking-actions";

/**
 * Choose a day, a time, confirm (20261105100000). The days and times are the
 * server's — coach_booking_slots() in the coach's zone — and every time is
 * shown in that zone, named. Nothing here decides whether a time is free;
 * book_service() checks it again and a refusal (SLOT_UNAVAILABLE) refreshes
 * the times.
 */
export function BookingPicker({
  serviceId, serviceName, durationMinutes, confirmation, timezone, price, coachName,
  days, slots, canBook, signedIn, loginNext, initialAt = null, prevHref, nextHref,
}: {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  confirmation: "instant" | "approval";
  timezone: string;
  price: string | null;
  coachName: string;
  days: string[];
  slots: Slot[];
  canBook: "ok" | BookingErrorCode;
  signedIn: boolean;
  /** This page's own address: signing in comes back here, with the chosen time (`at`) kept. */
  loginNext: string;
  /** A time chosen before signing in (?at=), picked again when it is still free. */
  initialAt?: string | null;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const { t, locale } = useI18n();
  const b = t.coachProfile.bookings.book;
  const e = t.coachProfile.bookings.errors;
  const router = useRouter();
  const loc = locale === "ro" ? "ro-RO" : "en-GB";

  // the slots by the coach's calendar date
  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const d = zonedDate(new Date(s.start_at), timezone);
      map.set(d, [...(map.get(d) ?? []), s]);
    }
    return map;
  }, [slots, timezone]);

  const resumed = initialAt ? slots.find((s) => new Date(s.start_at).getTime() === new Date(initialAt).getTime()) ?? null : null;
  const [day, setDay] = useState<string>(() =>
    resumed ? zonedDate(new Date(resumed.start_at), timezone) : days.find((d) => byDay.has(d)) ?? days[0]!);
  const [chosen, setChosen] = useState<Slot | null>(resumed);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"booked" | "requested" | null>(null);
  const [pending, start] = useTransition();

  const time = (iso: string) => new Intl.DateTimeFormat(loc, { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(loc, { ...opts, timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

  function confirm() {
    if (!chosen) return;
    setError(null);
    start(async () => {
      const result = await bookService({ serviceId, startAt: chosen.start_at, note: note.trim() || null });
      if (result.ok) {
        setDone(confirmation === "instant" ? "booked" : "requested");
        return;
      }
      const code = result.errorCode as keyof typeof e | undefined;
      setError((code && code in e ? e[code] : null) ?? e.generic);
      setChosen(null);
      router.refresh(); // the times as they are now
    });
  }

  if (done) {
    return (
      <div className="rounded-3xl bg-surface px-6 py-10 text-center" data-testid="booking-done" data-outcome={done}>
        <p className="font-display text-xl font-bold">{done === "booked" ? b.booked : b.requested}</p>
        <p className="mt-2 text-[14px] text-ink-soft">{b.bookedBody}</p>
        <Link href="/coaches/bookings" className={`${BUTTON} mt-5`}>{b.myBookings}</Link>
      </div>
    );
  }

  const daySlots = byDay.get(day) ?? [];
  const blocked = canBook !== "ok" && canBook !== "CANNOT_BOOK_SELF";

  return (
    <div className="grid gap-4" data-testid="booking-picker">
      {/* what is being booked: service, length, zone, price (informational) */}
      <div className="rounded-3xl bg-surface p-5">
        <p className="font-display text-lg font-bold tracking-tight">{serviceName}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
          <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft">{fill(b.duration, { minutes: durationMinutes })}</li>
          <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft" data-testid="booking-zone">{zoneLabel(timezone)}</li>
        </ul>
        <p className="mt-2 text-[13px] text-ink-soft">{fill(b.zoneNote, { zone: timezone })}</p>
        {price ? <p className="mt-1 text-[13px] text-ink-soft">{fill(b.priceNote, { price })}</p> : null}
      </div>

      {canBook === "CANNOT_BOOK_SELF" ? <p className="text-[13px] text-ink-faint">{b.self}</p> : null}
      {blocked ? (
        <p className="rounded-3xl bg-surface px-6 py-8 text-center font-semibold" data-testid="booking-blocked">
          {canBook === "CLIENTS_ONLY" ? fill(b.clientsOnly, { name: coachName }) : b.unavailable}
        </p>
      ) : (
        <>
          <section aria-label={b.chooseDay}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{b.chooseDay}</h2>
              <span className="flex gap-1.5">
                {prevHref ? <Link href={prevHref} className="inline-flex h-9 items-center rounded-xl bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:text-ink">← {b.prevWeek}</Link> : null}
                {nextHref ? <Link href={nextHref} className="inline-flex h-9 items-center rounded-xl bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:text-ink" data-testid="booking-next-week">{b.nextWeek} →</Link> : null}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {days.map((d) => {
                const count = byDay.get(d)?.length ?? 0;
                return (
                  <button key={d} type="button" onClick={() => { setDay(d); setChosen(null); }} disabled={count === 0}
                    aria-pressed={day === d} data-testid="booking-day" data-date={d} data-slots={count}
                    className={`flex flex-col items-center rounded-2xl px-1 py-2.5 text-center disabled:opacity-40 ${
                      day === d ? "bg-accent text-accent-fg" : "bg-surface text-ink hover:bg-accent-soft/60"}`}>
                    <span className="text-[11px] font-semibold uppercase">{dayLabel(d, { weekday: "short" })}</span>
                    <span className="font-display text-[17px] font-bold tabular-nums">{dayLabel(d, { day: "numeric" })}</span>
                  </button>
                );
              })}
            </div>
            {slots.length === 0 ? <p className="mt-3 text-[13px] text-ink-faint" data-testid="booking-no-slots">{b.noSlotsWeek}</p> : null}
          </section>

          {slots.length > 0 ? (
            <section aria-label={b.chooseTime}>
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-ink-faint">
                {b.chooseTime} · {dayLabel(day, { weekday: "long", day: "numeric", month: "long" })}
              </h2>
              {daySlots.length === 0 ? <p className="mt-2 text-[13px] text-ink-faint">{b.noSlotsDay}</p> : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {daySlots.map((s) => (
                    <button key={s.start_at} type="button" onClick={() => setChosen(s)} aria-pressed={chosen?.start_at === s.start_at}
                      data-testid="booking-slot" data-start={s.start_at}
                      className={`h-10 rounded-xl px-3.5 text-[14px] font-semibold tabular-nums ${
                        chosen?.start_at === s.start_at ? "bg-accent text-accent-fg" : "bg-surface text-ink hover:bg-accent-soft/60"}`}>
                      {time(s.start_at)}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {error ? <p role="alert" className="text-[13px] text-risk" data-testid="booking-error">{error}</p> : null}

          {chosen ? (
            <section className="rounded-3xl bg-surface p-5" data-testid="booking-confirm">
              <p className="font-display text-lg font-bold">
                {fill(b.selected, { date: dayLabel(day, { weekday: "long", day: "numeric", month: "long" }), time: `${time(chosen.start_at)} – ${time(chosen.end_at)}` })}
              </p>
              <p className="mt-1 text-[13px] text-ink-soft">
                {confirmation === "instant" ? b.instantNote : fill(b.approvalNote, { name: coachName })}
              </p>
              {signedIn && canBook === "ok" ? (
                <>
                  <label className={`${LABEL} mt-4`}>{b.note}
                    <textarea value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={1000} rows={3}
                      className={`${FIELD} h-auto py-2.5`} />
                  </label>
                  <button type="button" className={`${BUTTON} mt-4`} disabled={pending} onClick={confirm} data-testid="booking-submit">
                    {confirmation === "instant" ? b.confirm : b.request}
                  </button>
                </>
              ) : !signedIn ? (
                <Link href={`/login?${new URLSearchParams({ next: `${loginNext}&${new URLSearchParams({ at: chosen.start_at })}` })}`}
                  className={`${BUTTON} mt-4`} data-testid="booking-sign-in" data-mkt-wall="book">{b.signIn}</Link>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
