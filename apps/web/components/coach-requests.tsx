"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { CoachRequestRow, MyCoachingRequestRow } from "@/lib/coach-profile-data";
import type { ActionResult } from "@/app/actions";
import {
  acceptCoachingRequest, cancelCoachingRequest, declineCoachingRequest, startCoachingFromRequest,
} from "@/app/coach-profile-actions";
import { Avatar } from "./social";
import { Card } from "./ui";

// Contact requests (20261103100000): the coach's list on /requests and the
// client's on /coaches/requests. Each row shows only what the request itself
// carries — the client's public name and avatar, the service, the message,
// the goal and the format — and the one or two moves its state allows. The
// database decides every move; a refresh re-reads the truth after each.

const PILL: Record<string, string> = {
  pending: "bg-warn-soft text-warn",
  accepted: "bg-accent-soft text-accent-ink",
  declined: "bg-bg text-ink-faint",
  cancelled: "bg-bg text-ink-faint",
  closed: "bg-bg text-ink-faint",
};
const ACCENT_BTN = "inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-50";
const QUIET_BTN = "inline-flex h-10 items-center rounded-xl bg-bg px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50";

function useDate() {
  const { locale } = useI18n();
  return (iso: string) => new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

/** Run one request action, refresh on success, keep the error otherwise. */
function useRequestAction() {
  const { t } = useI18n();
  const e = t.coachProfile.requests.errors;
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

export function CoachRequestList({ rows }: { rows: CoachRequestRow[] }) {
  const { t } = useI18n();
  const r = t.coachProfile.requests;
  const deliveries = t.coachProfile.services.deliveries;
  const date = useDate();
  const { run, busy, error } = useRequestAction();

  if (rows.length === 0) {
    return (
      <Card plain>
        <p className="font-display text-lg font-bold">{r.empty}</p>
        <p className="mt-1 text-[13.5px] text-ink-soft">{r.emptyHint}</p>
      </Card>
    );
  }
  return (
    <div className="grid gap-2.5" data-testid="coach-requests">
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      {rows.map((q) => (
        <article key={q.id} className="rounded-3xl bg-surface p-4 sm:p-5" data-testid="coach-request" data-status={q.status}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={q.client_name} url={q.client_avatar} size="h-11 w-11" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{q.client_name}</p>
                <p className="text-[12.5px] text-ink-faint">
                  {[fill(r.sentOn, { date: date(q.created_at) }), q.gym_name ? fill(r.foundAt, { gym: q.gym_name }) : null].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${PILL[q.status] ?? PILL.closed}`}>
              {q.started ? r.started : r.statuses[q.status]}
            </span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5 text-[12.5px]">
            {q.service_name ? <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft">{fill(r.service, { name: q.service_name })}</li> : null}
            {q.preferred_format ? <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft">{fill(r.format, { format: deliveries[q.preferred_format] })}</li> : null}
          </ul>
          {q.goal ? <p className="mt-2 text-[13.5px] font-semibold">{fill(r.goal, { goal: q.goal })}</p> : null}
          {q.message ? <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">{q.message}</p> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {q.status === "pending" ? (
              <>
                <button type="button" className={ACCENT_BTN} disabled={busy} onClick={() => run(() => acceptCoachingRequest(q.id))}
                  data-testid="request-accept">{r.accept}</button>
                <button type="button" className={QUIET_BTN} disabled={busy} onClick={() => run(() => declineCoachingRequest(q.id))}
                  data-testid="request-decline">{r.decline}</button>
              </>
            ) : null}
            {q.status === "accepted" && !q.started ? (
              <>
                <button type="button" className={ACCENT_BTN} disabled={busy} onClick={() => run(() => startCoachingFromRequest(q.id))}
                  title={r.startHint} data-testid="request-start">{r.startCoaching}</button>
                <span className="text-[12.5px] text-ink-faint">{r.startHint}</span>
              </>
            ) : null}
            {q.started ? <Link href={`/clients/${q.client_id}`} className={QUIET_BTN}>{r.openClient}</Link> : null}
            <Link href={`/people/${q.client_id}`} className="text-[13px] font-semibold text-ink-faint hover:text-ink">{r.profile}</Link>
          </div>
        </article>
      ))}
    </div>
  );
}

export function MyRequestList({ rows }: { rows: MyCoachingRequestRow[] }) {
  const { t } = useI18n();
  const r = t.coachProfile.requests;
  const m = r.mine;
  const deliveries = t.coachProfile.services.deliveries;
  const date = useDate();
  const { run, busy, error } = useRequestAction();

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl bg-surface px-6 py-12 text-center" data-testid="my-requests-empty">
        <p className="font-display text-lg font-bold">{m.empty}</p>
        <Link href="/coaches"
          className="mt-5 inline-flex h-11 items-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90">
          {m.emptyCta}
        </Link>
      </div>
    );
  }
  return (
    <div className="grid gap-2.5" data-testid="my-requests">
      {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
      {rows.map((q) => (
        <article key={q.id} className="rounded-3xl bg-surface p-4 sm:p-5" data-testid="my-request" data-status={q.status}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={q.coach_name} url={q.coach_avatar} size="h-11 w-11" />
              <div className="min-w-0">
                {q.coach_slug ? (
                  <Link href={`/coaches/${q.coach_slug}`} className="truncate font-semibold hover:text-accent-ink">{q.coach_name}</Link>
                ) : (
                  <p className="truncate font-semibold">{q.coach_name}</p>
                )}
                <p className="text-[12.5px] text-ink-faint">{fill(r.sentOn, { date: date(q.created_at) })}</p>
              </div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${PILL[q.status] ?? PILL.closed}`}>
              {r.statuses[q.status]}
            </span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5 text-[12.5px]">
            {q.service_name ? <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft">{fill(r.service, { name: q.service_name })}</li> : null}
            {q.preferred_format ? <li className="rounded-full bg-bg px-2.5 py-1 font-semibold text-ink-soft">{fill(r.format, { format: deliveries[q.preferred_format] })}</li> : null}
          </ul>
          {q.goal ? <p className="mt-2 text-[13.5px] font-semibold">{fill(r.goal, { goal: q.goal })}</p> : null}
          {q.message ? <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-ink-soft">{q.message}</p> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
            {q.status === "pending" ? (
              <button type="button" className={QUIET_BTN} disabled={busy} data-testid="my-request-cancel"
                onClick={() => run(() => cancelCoachingRequest({ requestId: q.id, slug: q.coach_slug ?? "" }))}>
                {m.cancel}
              </button>
            ) : null}
            {q.status === "accepted" && q.started ? (
              <><span className="font-semibold text-accent-ink">{m.startedNext}</span><Link href="/coach" className={QUIET_BTN}>{m.openCoach}</Link></>
            ) : q.status === "accepted" ? (
              <span className="font-semibold text-accent-ink">{m.acceptedNext}</span>
            ) : null}
            {["declined", "cancelled", "closed"].includes(q.status) && q.coach_slug ? (
              <Link href={`/coaches/${q.coach_slug}`} className={QUIET_BTN}>{m.contactAgain}</Link>
            ) : null}
            {!q.coach_slug ? <span className="text-ink-faint">{m.coachGone}</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}
