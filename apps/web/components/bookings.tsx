"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bookingMoves, type BookingMove } from "@healthapp/shared";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { formatPrice } from "@/lib/coach-onboarding";
import { formatBookingTime, zoneLabel, type BookingRow } from "@/lib/booking";
import type { ActionResult } from "@/app/actions";
import { cancelBooking, markBooking, respondBooking } from "@/app/booking-actions";
import { Avatar } from "./social";

// Bookings (20261105100000): the coach's list on /bookings and the client's on
// /coaches/bookings. Each row shows who, what, when — in the booking's own
// zone, labelled — and the moves bookingMoves() allows, which are exactly the
// ones the RPCs accept. The database decides; a refresh re-reads the truth.

const PILL: Record<string, string> = {
  pending: "bg-warn-soft text-warn",
  confirmed: "bg-accent-soft text-accent-ink",
  completed: "bg-bg text-ink-soft",
  no_show: "bg-risk-soft text-risk",
  declined: "bg-bg text-ink-faint",
  cancelled: "bg-bg text-ink-faint",
};
const ACCENT_BTN = "inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50";
const QUIET_BTN = "inline-flex h-10 items-center rounded-xl bg-bg px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50";

function useBookingAction() {
  const { t } = useI18n();
  const e = t.coachProfile.bookings.errors;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) => {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        const code = result.errorCode as keyof typeof e | undefined;
        setError((code && code in e ? e[code] : null) ?? e.generic);
      }
      router.refresh();
    });
  };
  return { run, busy, error };
}

/**
 * Decline and cancel ask once more, with an optional reason, inline — never
 * a native prompt, whose own "Cancel" would still have cancelled the booking.
 */
function ConfirmWithReason({ label, onConfirm, busy, testId }: {
  label: string; onConfirm: (reason: string | null) => void; busy: boolean; testId: string;
}) {
  const { t } = useI18n();
  const b = t.coachProfile.bookings;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return <button type="button" className={QUIET_BTN} disabled={busy} data-testid={testId} onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={b.reasonPrompt}
        aria-label={b.reasonPrompt} autoFocus
        className="h-10 min-w-0 flex-1 rounded-xl bg-bg px-3 text-[13.5px] outline-none ring-accent/50 focus:ring-2" />
      <button type="button" className={ACCENT_BTN} disabled={busy} data-testid={`${testId}-confirm`}
        onClick={() => onConfirm(reason.trim() || null)}>{label}</button>
      <button type="button" className="text-[13px] font-semibold text-ink-faint hover:text-ink" onClick={() => setOpen(false)}>✕</button>
    </span>
  );
}

function BookingCard({ row, side, children }: { row: BookingRow; side: "coach" | "client"; children?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const b = t.coachProfile.bookings;
  const when = formatBookingTime(row, locale);
  const price = formatPrice(row.price_cents, row.currency, locale);
  const name = side === "client" && row.coach_slug ? (
    <Link href={`/coaches/${row.coach_slug}`} className="truncate font-semibold hover:text-accent-ink">{row.person_name}</Link>
  ) : side === "coach" ? (
    <Link href={`/people/${row.person_id}`} className="truncate font-semibold hover:text-accent-ink">{row.person_name}</Link>
  ) : (
    <p className="truncate font-semibold">{row.person_name}</p>
  );
  return (
    <article className="rounded-3xl bg-surface p-4 sm:p-5" data-testid="booking" data-status={row.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.person_name} url={row.person_avatar} size="h-11 w-11" />
          <div className="min-w-0">
            {name}
            <p className="text-[12.5px] text-ink-faint">{row.service_name}{price ? ` · ${price}` : ""}</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${PILL[row.status] ?? PILL.cancelled}`}>
          {b.statuses[row.status]}
        </span>
      </div>
      <p className="mt-3 font-display text-[17px] font-bold tracking-tight" data-testid="booking-when">
        {when.date} · {when.time}
        <span className="ml-2 text-[12.5px] font-semibold text-ink-faint">{fill(b.zone, { zone: zoneLabel(row.timezone) })}</span>
      </p>
      {row.note ? <p className="mt-1.5 whitespace-pre-line text-[13.5px] text-ink-soft">{fill(b.note, { note: row.note })}</p> : null}
      {row.status === "cancelled" ? (
        <p className="mt-1.5 text-[12.5px] text-ink-faint">
          {row.cancelled_by_me ? b.cancelledByYou : fill(b.cancelledByOther, { name: row.person_name })}
          {row.cancellation_reason ? ` · ${fill(b.reason, { reason: row.cancellation_reason })}` : ""}
        </p>
      ) : row.status === "declined" && row.cancellation_reason ? (
        <p className="mt-1.5 text-[12.5px] text-ink-faint">{fill(b.reason, { reason: row.cancellation_reason })}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {children}
        {/* the pair's existing conversation, if any — a booking never opens one */}
        {row.conversation_id ? (
          <Link href={side === "coach" ? `/messages/${row.conversation_id}` : `/coach/messages/${row.conversation_id}`}
            className="text-[13px] font-semibold text-ink-faint hover:text-ink">{b.message}</Link>
        ) : null}
      </div>
    </article>
  );
}

export function CoachBookingList({ rows }: { rows: BookingRow[] }) {
  const { t } = useI18n();
  const b = t.coachProfile.bookings;
  const { run, busy, error } = useBookingAction();
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl bg-surface px-6 py-10 text-center" data-testid="bookings-empty">
        <p className="font-display text-lg font-bold">{b.empty}</p>
        <p className="mt-1 text-[13.5px] text-ink-soft">{b.emptyHint}</p>
      </div>
    );
  }
  const act = (row: BookingRow, move: BookingMove) => {
    if (move === "accept") return run(() => respondBooking(row.id, true));
    return run(() => markBooking(row.id, move === "complete" ? "completed" : "no_show"));
  };
  return (
    <div className="grid gap-2.5" data-testid="coach-bookings">
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      {rows.map((row) => (
        <BookingCard key={row.id} row={row} side="coach">
          {bookingMoves(row, "coach").map((move, i) =>
            move === "decline" ? (
              <ConfirmWithReason key={move} label={b.moves.decline} busy={busy} testId="booking-decline"
                onConfirm={(reason) => run(() => respondBooking(row.id, false, reason))} />
            ) : move === "cancel" ? (
              <ConfirmWithReason key={move} label={b.moves.cancel} busy={busy} testId="booking-cancel"
                onConfirm={(reason) => run(() => cancelBooking(row.id, reason))} />
            ) : (
              <button key={move} type="button" disabled={busy} data-testid={`booking-${move}`}
                className={i === 0 ? ACCENT_BTN : QUIET_BTN} onClick={() => act(row, move)}>
                {b.moves[move]}
              </button>
            ))}
        </BookingCard>
      ))}
    </div>
  );
}

/** The client's bookings, in four groups: upcoming, waiting for the coach, past, cancelled. */
export function MyBookingList({ rows }: { rows: BookingRow[] }) {
  const { t } = useI18n();
  const b = t.coachProfile.bookings;
  const m = b.mine;
  const { run, busy, error } = useBookingAction();
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl bg-surface px-6 py-12 text-center" data-testid="my-bookings-empty">
        <p className="font-display text-lg font-bold">{m.empty}</p>
        <Link href="/coaches" className="mt-5 inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90">
          {m.emptyCta}
        </Link>
      </div>
    );
  }
  const now = Date.now();
  const future = (r: BookingRow) => new Date(r.start_at).getTime() > now;
  const groups: { key: keyof typeof m.sections; rows: BookingRow[] }[] = [
    { key: "upcoming", rows: rows.filter((r) => r.status === "confirmed" && future(r)) },
    { key: "pending", rows: rows.filter((r) => r.status === "pending") },
    { key: "past", rows: rows.filter((r) => r.status === "completed" || r.status === "no_show" || (r.status === "confirmed" && !future(r)))
      .sort((a, z) => z.start_at.localeCompare(a.start_at)) },
    { key: "cancelled", rows: rows.filter((r) => r.status === "cancelled" || r.status === "declined")
      .sort((a, z) => z.start_at.localeCompare(a.start_at)) },
  ];
  return (
    <div className="grid gap-6" data-testid="my-bookings">
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.key} aria-label={m.sections[g.key]} data-testid={`my-bookings-${g.key}`}>
          <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-ink-faint">{m.sections[g.key]}</h2>
          <div className="grid gap-2.5">
            {g.rows.map((row) => (
              <BookingCard key={row.id} row={row} side="client">
                {row.status === "completed" && row.coach_slug ? (
                  <Link href={`/coaches/${row.coach_slug}/review`} className={QUIET_BTN} data-testid="booking-review">
                    {t.coachProfile.reviews.write}
                  </Link>
                ) : null}
                {bookingMoves(row, "client").includes("cancel") ? (
                  <ConfirmWithReason label={m.cancel} busy={busy} testId="booking-cancel"
                    onConfirm={(reason) => run(() => cancelBooking(row.id, reason))} />
                ) : null}
              </BookingCard>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
