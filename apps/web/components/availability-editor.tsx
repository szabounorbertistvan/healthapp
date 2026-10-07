"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  availabilityProblems, bookingSettingsProblems, WEEKDAYS, type BookingSettings,
} from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { BUTTON, FIELD, LABEL, SMALL_BUTTON } from "@/lib/form-classes";
import type { AvailabilityRow, ExceptionRow, ServiceBookingRow } from "@/lib/booking";
import type { ActionResult } from "@/app/actions";
import {
  addAvailability, addTimeOff, deleteAvailability, deleteTimeOff, setServiceBooking, updateAvailability,
} from "@/app/booking-actions";
import { Switch } from "./ui";

// The coach's side of booking (20261105100000): the week, time off, and which
// services can be booked and how. Each control checks itself with the rules
// the database holds (@healthapp/shared/booking) so a mistake is named before
// it is sent; the database still has the last word (OVERLAP, INVALID_INTERVAL).

const hhmm = (t: string | null) => (t ?? "").slice(0, 5);

function useAction() {
  const { t } = useI18n();
  const e = t.coachProfile.bookings.errors;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        const code = result.errorCode as keyof typeof e | undefined;
        setError((code && code in e ? e[code] : null) ?? e.generic);
      } else {
        after?.();
      }
      router.refresh();
    });
  };
  return { run, busy, error };
}

function weekdayName(weekday: number, locale: "en" | "ro") {
  // 2024-01-01 was a Monday: ISO weekday n is that date + n - 1
  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { weekday: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2024, 0, weekday)));
}

export function WeeklyHours({ blocks }: { blocks: AvailabilityRow[] }) {
  const { t, locale } = useI18n();
  const a = t.coachProfile.bookings.availability;
  const { run, busy, error } = useAction();
  const [adding, setAdding] = useState<number | null>(null);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");

  const asBlocks = blocks.map((b) => ({ id: b.id, weekday: b.weekday, start: hhmm(b.start_time), end: hhmm(b.end_time), active: b.active }));
  const draftProblems = adding === null ? [] :
    availabilityProblems([...asBlocks, { weekday: adding, start: from, end: to, active: true }]).at(-1) ?? [];

  return (
    <div className="grid gap-2" data-testid="weekly-hours">
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      {WEEKDAYS.map((wd) => {
        const day = asBlocks.filter((b) => b.weekday === wd);
        return (
          <div key={wd} className="rounded-2xl bg-surface p-4" data-testid="weekday" data-weekday={wd}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold capitalize">{weekdayName(wd, locale)}</p>
              {adding !== wd ? (
                <button type="button" className={SMALL_BUTTON} onClick={() => { setAdding(wd); setFrom("09:00"); setTo("13:00"); }}
                  data-testid="add-hours">+ {a.addHours}</button>
              ) : null}
            </div>
            {day.length === 0 && adding !== wd ? <p className="mt-1 text-[13px] text-ink-faint">{a.unavailable}</p> : null}
            <ul className="mt-2 grid gap-1.5">
              {day.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2" data-testid="hours" data-active={b.active}>
                  <span className={`font-display text-[15px] font-bold tabular-nums ${b.active ? "" : "text-ink-faint line-through"}`}>
                    {b.start} — {b.end}
                  </span>
                  <button type="button" className={SMALL_BUTTON} disabled={busy}
                    onClick={() => run(() => updateAvailability({ id: b.id!, weekday: b.weekday, start: b.start, end: b.end, active: !b.active }))}>
                    {b.active ? a.on : a.off}
                  </button>
                  <button type="button" className="text-[13px] font-semibold text-ink-faint hover:text-risk" disabled={busy}
                    onClick={() => run(() => deleteAvailability(b.id!))}>{a.remove}</button>
                </li>
              ))}
            </ul>
            {adding === wd ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className={LABEL}>{a.from}
                  <input type="time" step={300} value={from} onChange={(e) => setFrom(e.target.value)} className={`${FIELD} w-32`} data-testid="hours-from" />
                </label>
                <label className={LABEL}>{a.to}
                  <input type="time" step={300} value={to} onChange={(e) => setTo(e.target.value)} className={`${FIELD} w-32`} data-testid="hours-to" />
                </label>
                <button type="button" className={BUTTON} disabled={busy || draftProblems.length > 0} data-testid="hours-add"
                  onClick={() => run(() => addAvailability({ weekday: wd, start: from, end: to, active: true }), () => setAdding(null))}>
                  {a.add}
                </button>
                <button type="button" className="h-11 px-2 text-[13px] font-semibold text-ink-faint hover:text-ink" onClick={() => setAdding(null)}>✕</button>
                {draftProblems.length ? <p className="w-full text-[12.5px] text-risk">{a.problems[draftProblems[0]!]}</p> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function TimeOff({ exceptions, today }: { exceptions: ExceptionRow[]; today: string }) {
  const { t, locale } = useI18n();
  const a = t.coachProfile.bookings.availability;
  const { run, busy, error } = useAction();
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("12:00");
  const [title, setTitle] = useState("");
  const date = (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB",
    { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const invalid = allDay ? endDate < startDate : !(from < to);

  return (
    <div className="grid gap-3" data-testid="time-off">
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      {exceptions.length === 0 ? <p className="text-[13px] text-ink-faint">{a.noTimeOff}</p> : (
        <ul className="grid gap-1.5">
          {exceptions.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface px-4 py-3" data-testid="time-off-row">
              <span className="font-semibold">
                {e.all_day
                  ? (e.start_date === e.end_date ? date(e.start_date) : `${date(e.start_date)} — ${date(e.end_date)}`) + ` · ${a.allDay}`
                  : `${date(e.start_date)} · ${hhmm(e.start_time)} — ${hhmm(e.end_time)}`}
              </span>
              {e.title ? <span className="text-[13px] text-ink-soft">{e.title}</span> : null}
              <button type="button" className="ml-auto text-[13px] font-semibold text-ink-faint hover:text-risk" disabled={busy}
                onClick={() => run(() => deleteTimeOff(e.id))}>{a.remove}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-2xl bg-surface p-4">
        <Switch checked={allDay} onChange={setAllDay} label={a.allDay} onLabel={a.on} offLabel={a.off} />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className={LABEL}>{allDay ? a.startDate : a.date}
            <input type="date" value={startDate} min={today} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }}
              className={`${FIELD} w-44`} />
          </label>
          {allDay ? (
            <label className={LABEL}>{a.endDate}
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={`${FIELD} w-44`} />
            </label>
          ) : (
            <>
              <label className={LABEL}>{a.from}
                <input type="time" step={300} value={from} onChange={(e) => setFrom(e.target.value)} className={`${FIELD} w-32`} />
              </label>
              <label className={LABEL}>{a.to}
                <input type="time" step={300} value={to} onChange={(e) => setTo(e.target.value)} className={`${FIELD} w-32`} />
              </label>
            </>
          )}
          <label className={`${LABEL} min-w-40 flex-1`}>{a.reason}
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={FIELD} />
          </label>
          <button type="button" className={BUTTON} disabled={busy || invalid} data-testid="time-off-add"
            onClick={() => run(() => addTimeOff({ startDate, endDate, allDay, start: allDay ? null : from, end: allDay ? null : to, title: title || null }),
              () => setTitle(""))}>
            {a.addTimeOff}
          </button>
        </div>
      </div>
    </div>
  );
}

function toSettings(s: ServiceBookingRow): BookingSettings {
  return {
    bookable: s.bookable,
    durationMinutes: s.booking_duration_minutes ?? 60,
    bufferBeforeMinutes: s.booking_buffer_before_minutes,
    bufferAfterMinutes: s.booking_buffer_after_minutes,
    minNoticeMinutes: s.booking_min_notice_minutes,
    maxAdvanceDays: s.booking_max_advance_days,
    access: s.booking_access,
    confirmation: s.booking_confirmation,
  };
}

function ServiceBooking({ service }: { service: ServiceBookingRow }) {
  const { t } = useI18n();
  const a = t.coachProfile.bookings.availability;
  const { run, busy, error } = useAction();
  const [s, setS] = useState<BookingSettings>(() => toSettings(service));
  const [saved, setSaved] = useState(false);
  const digital = service.delivery === "digital";
  const problems = bookingSettingsProblems(s, service.delivery);
  const num = (key: keyof BookingSettings, scale = 1) => ({
    value: String(Math.round((s[key] as number) / scale)),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setSaved(false);
      setS({ ...s, [key]: e.target.value === "" ? 0 : Math.round(Number(e.target.value) * scale) });
    },
  });
  const set = (patch: Partial<BookingSettings>) => { setSaved(false); setS({ ...s, ...patch }); };

  return (
    <div className="rounded-2xl bg-surface p-4" data-testid="service-booking" data-service={service.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{service.name}</p>
        {!service.active ? <span className="text-[12px] font-semibold text-ink-faint">{a.inactive}</span> : null}
      </div>
      {digital ? <p className="mt-1 text-[13px] text-ink-faint">{a.digital}</p> : (
        <>
          <div className="mt-3">
            <Switch checked={s.bookable} onChange={(v) => set({ bookable: v })} label={a.bookable} onLabel={a.on} offLabel={a.off} />
          </div>
          {s.bookable ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className={LABEL}>{a.duration}<input type="number" min={10} max={480} step={5} className={FIELD} {...num("durationMinutes")} data-testid="booking-duration" /></label>
              <label className={LABEL}>{a.bufferBefore}<input type="number" min={0} max={240} step={5} className={FIELD} {...num("bufferBeforeMinutes")} /></label>
              <label className={LABEL}>{a.bufferAfter}<input type="number" min={0} max={240} step={5} className={FIELD} {...num("bufferAfterMinutes")} /></label>
              <label className={LABEL}>{a.minNotice}<input type="number" min={0} max={720} className={FIELD} {...num("minNoticeMinutes", 60)} /></label>
              <label className={LABEL}>{a.maxAdvance}<input type="number" min={1} max={365} className={FIELD} {...num("maxAdvanceDays")} /></label>
              <label className={LABEL}>&nbsp;
                <select className={FIELD} value={s.access} onChange={(e) => set({ access: e.target.value as BookingSettings["access"] })} data-testid="booking-access">
                  <option value="public">{a.access.public}</option>
                  <option value="clients">{a.access.clients}</option>
                </select>
              </label>
              <label className={`${LABEL} sm:col-span-3`}>
                <select className={FIELD} value={s.confirmation} onChange={(e) => set({ confirmation: e.target.value as BookingSettings["confirmation"] })} data-testid="booking-confirmation">
                  <option value="approval">{a.confirmation.approval}</option>
                  <option value="instant">{a.confirmation.instant}</option>
                </select>
              </label>
            </div>
          ) : null}
          {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
          {problems.length && !error ? <p className="mt-2 text-[12.5px] text-risk">{t.coachProfile.bookings.errors.INVALID_BOOKING_SETTINGS}</p> : null}
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className={BUTTON} disabled={busy || problems.length > 0} data-testid="booking-save"
              onClick={() => run(() => setServiceBooking({ serviceId: service.id, ...s }), () => setSaved(true))}>
              {a.save}
            </button>
            {saved ? <span className="text-[13px] font-semibold text-accent-ink" role="status">{a.saved}</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

export function ServiceBookingSettings({ services }: { services: ServiceBookingRow[] }) {
  return (
    <div className="grid gap-2.5" data-testid="service-booking-list">
      {services.map((s) => <ServiceBooking key={s.id} service={s} />)}
    </div>
  );
}

/** "Times are in Europe/Bucharest", with the way to change it. */
export function ZoneNote({ timezone }: { timezone: string }) {
  const { t } = useI18n();
  const a = t.coachProfile.bookings.availability;
  return (
    <p className="text-[13px] text-ink-soft" data-testid="coach-timezone">
      {fill(a.zone, { zone: timezone })}
      {" · "}
      <a href="/settings" className="font-semibold text-accent-ink hover:underline">{a.changeZone}</a>
    </p>
  );
}
