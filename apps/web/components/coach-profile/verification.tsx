"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { MyCoachProfile } from "@/lib/coach-profile";
import { credentialLabel, summary, verificationView, type StatusView } from "@/lib/coach-onboarding";
import { BUTTON, FIELD, HINT, LABEL } from "@/lib/form-classes";
import { requestCoachVerification } from "@/app/coach-profile-actions";
import { Card } from "../ui";
import { VerifiedBadge } from "../coach-discovery/verified-badge";
import { useCoachError } from "./status";

const TONE: Record<StatusView["tone"], string> = {
  neutral: "bg-bg text-ink-soft",
  warn: "bg-warn-soft text-warn",
  accent: "bg-accent-soft text-accent-ink",
  risk: "bg-risk-soft text-risk",
};

/**
 * The coach's Verification section (/settings/coach-profile, 20261101100000):
 * where the request stands, what is needed, what Voinic will look at (each
 * credential with its own state), the admin's reason after a refusal, and
 * the one action a coach has — ask (again). Deciding is an admin's
 * (admin_set_coach_verification_status); nothing here can verify anything.
 */
export function VerificationCard({ data }: { data: MyCoachProfile }) {
  const { t, locale } = useI18n();
  const v = t.coachProfile.verification;
  const c = t.coachProfile.certifications;
  const groups = t.coachProfile.publish.groups;
  const router = useRouter();
  const coachError = useCoachError();
  const ids = useId();
  const p = data.profile;
  const view = verificationView(p.verification_status);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = summary(data.missing).filter((x) => !x.done).map((x) => groups[x.group]);
  const complete = data.missing.length === 0;
  const today = new Date().toISOString().slice(0, 10);
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "";
  const credentialStatus = (s: string) =>
    s === "verified" ? c.statusVerified : s === "pending" ? c.statusPending : s === "rejected" ? c.statusRejected : c.statusUnverified;

  function ask() {
    setError(null);
    start(async () => {
      const result = await requestCoachVerification(message);
      if (result.missing?.length) {
        setError(fill(v.missing, { list: summary(result.missing).filter((x) => !x.done).map((x) => groups[x.group]).join(", ") }));
        return;
      }
      if (!result.ok) {
        setError(coachError(result));
        return;
      }
      setMessage("");
      router.refresh();
    });
  }

  return (
    <Card plain>
      <section aria-labelledby="coach-verification" data-testid="coach-verification" data-status={p.verification_status}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="coach-verification" className="font-display text-lg font-bold tracking-tight">{v.title}</h2>
          {p.verification_status === "verified" ? (
            <VerifiedBadge verified size="md" />
          ) : (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${TONE[view.tone]}`}>
              {v.statuses[p.verification_status]}
            </span>
          )}
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{v.bodies[p.verification_status]}</p>
        {p.verification_status === "pending" && p.verification_requested_at ? (
          <p className="mt-1 text-[12.5px] text-ink-faint">{fill(v.requestedOn, { date: date(p.verification_requested_at) })}</p>
        ) : null}
        {p.verification_status === "rejected" && p.verification_note ? (
          <p className="mt-3 rounded-2xl bg-risk-soft px-3.5 py-2.5 text-[13.5px] leading-relaxed text-risk" data-testid="coach-verification-reason">
            {fill(v.reason, { note: p.verification_note })}
          </p>
        ) : null}

        {view.canRequest ? (
          <div className="mt-4 grid gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{v.requirements}</p>
            <ul className="grid gap-1.5 text-[14px]">
              <li className="flex items-center gap-2" data-done={complete}>
                <Tick done={complete} />
                <span className={complete ? "" : "text-ink-soft"}>{v.reqProfile}</span>
                {!complete ? <span className="text-[12.5px] text-ink-faint">— {open.join(", ")}</span> : null}
              </li>
              <li className="flex items-center gap-2" data-done={data.certifications.length > 0} data-optional>
                <Tick done={data.certifications.length > 0} optional />
                <span className={data.certifications.length ? "" : "text-ink-soft"}>{v.reqCredentials}</span>
                {data.certifications.length ? (
                  <span className="text-[12.5px] text-ink-faint">— {fill(v.reqCredentialsCount, { n: data.certifications.length })}</span>
                ) : null}
              </li>
            </ul>
          </div>
        ) : null}

        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{v.submitted}</p>
          {data.certifications.length === 0 ? (
            <p className={HINT}>{v.noCredentials}</p>
          ) : (
            <ul className="mt-1.5 grid gap-1.5">
              {data.certifications.map((cert) => {
                const label = credentialLabel(cert, today);
                return (
                  <li key={cert.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg px-3.5 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold">{cert.name}</span>
                      <span className="block text-[12px] text-ink-faint">
                        {[cert.issuer, cert.year, cert.credential_number ? fill(c.numberShort, { n: cert.credential_number }) : null,
                          cert.expires_on ? fill(c.expiresShort, { date: cert.expires_on }) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {label.expired ? <span className="rounded-full bg-risk-soft px-2.5 py-1 text-[11px] font-semibold text-risk">{c.expired}</span> : null}
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        cert.verification_status === "verified" ? "bg-accent-soft text-accent-ink"
                          : cert.verification_status === "pending" ? "bg-warn-soft text-warn"
                          : cert.verification_status === "rejected" ? "bg-risk-soft text-risk" : "bg-surface text-ink-faint"}`}>
                        {credentialStatus(cert.verification_status)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {p.status !== "draft" ? <p className={HINT}>{v.credentialsLocked}</p> : null}
        </div>

        {view.canRequest && p.status !== "suspended" ? (
          <div className="mt-4">
            <label className={LABEL} htmlFor={`${ids}-message`}>{v.message}</label>
            <textarea
              id={`${ids}-message`} className={`${FIELD} h-auto min-h-20 resize-y py-2.5`} rows={2} maxLength={1000}
              value={message} onChange={(e) => setMessage(e.target.value)}
            />
            <p className={HINT}>{v.messageHint}</p>
            <button type="button" className={`${BUTTON} mt-3`} disabled={pending || !complete} onClick={ask} data-testid="coach-verification-request">
              {pending ? v.requesting : p.verification_status === "rejected" ? v.requestAgain : v.request}
            </button>
          </div>
        ) : null}
        <p className={`${HINT} mt-4`}>{v.intro}</p>
        {error ? <p role="alert" className="mt-2 text-[13px] text-risk">{error}</p> : null}
      </section>
    </Card>
  );
}

function Tick({ done, optional = false }: { done: boolean; optional?: boolean }) {
  return (
    <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
      done ? "bg-accent text-accent-fg" : optional ? "border border-line text-ink-faint" : "bg-surface text-ink-faint"}`}>
      {done ? "✓" : ""}
    </span>
  );
}
