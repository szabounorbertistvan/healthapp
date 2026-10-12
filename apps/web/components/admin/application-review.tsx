"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { decideCoachApplication, setVerificationDocumentStatus } from "@/app/admin-coach-actions";
import { formatBytes, isLegacyIdentityDocument, type CoachDocument, type ApplicationMissing, type ReviewDecision } from "@/lib/coach-application";
import type { CoachProfileStatus } from "@/lib/coach-profile";
import { ConfirmAction } from "./confirm-action";

export type AdminApplication = {
  id: string;
  status: CoachProfileStatus;
  review_decision: ReviewDecision | null;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  missing: ApplicationMissing[];
  /** Declared disciplines still without a qualification (20261119100000; absent before). */
  missing_specializations?: string[];
  legacy: boolean;
  specializations: { slug: string; name_en: string; name_ro: string; is_primary: boolean; qualification_evidence: "required" | "recommended" | "none" }[];
  documents: (CoachDocument & { reviewed_at: string | null })[];
  history: {
    decision: "submitted" | "approved" | "changes_requested" | "rejected" | "revoked" | "legacy_approved";
    note: string | null; created_at: string;
    /** Historical: the identity-document box of 20261118100000, false on every decision since 20261119100000. */
    identity_reviewed: boolean;
    profile_reviewed?: boolean;
    qualifications_reviewed: boolean; actor: string | null;
  }[];
};

type Decision = "approved" | "changes_requested" | "rejected" | "revoked";

/**
 * Admin · one coach application (admin_coach_application, 20261118100000;
 * no identity documents since 20261119100000). The evidence first — what
 * each chosen discipline expects, the qualification documents
 * (opened through /api/coach-documents/[id], never a storage URL) — then the
 * two review boxes (profile, qualifications), the note and the decisions the status allows. The
 * database re-checks every one: the boxes, the evidence, the note, the
 * transition. The decision history says who decided what, and when.
 */
export function AdminApplicationReview({ application, name, fmt }: {
  application: AdminApplication;
  name: string;
  /** Server-formatted dates, keyed by ISO string, so server and browser agree. */
  fmt: Record<string, string>;
}) {
  const { t, locale } = useI18n();
  const m = t.admin.coaches.application;
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [profileReviewed, setProfileReviewed] = useState(false);
  const [qualifications, setQualifications] = useState(false);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const s = application.status;
  const options: Decision[] = s === "pending_review"
    ? ["approved", "changes_requested", "rejected"]
    : s === "published" || s === "hidden" ? ["approved", "revoked"] : [];
  const needsNote = (d: Decision) => d !== "approved";
  const canApprove = profileReviewed && qualifications && application.missing.length === 0;

  const label: Record<Decision, string> = { approved: m.approve, changes_requested: m.requestInfo, rejected: m.reject, revoked: m.revoke };
  const title: Record<Decision, string> = {
    approved: m.approveTitle, changes_requested: m.requestInfoTitle, rejected: m.rejectTitle, revoked: m.revokeTitle,
  };
  const body: Record<Decision, string> = {
    approved: m.approveBody, changes_requested: m.requestInfoBody, rejected: m.rejectBody, revoked: m.revokeBody,
  };

  function ask(d: Decision) {
    setError(null);
    if (needsNote(d) && !note.trim()) {
      setError(t.admin.coaches.errors.REASON_REQUIRED);
      return;
    }
    if (d === "approved" && !(profileReviewed && qualifications)) {
      setError(t.admin.coaches.errors.REVIEW_CHECKLIST_INCOMPLETE);
      return;
    }
    setDecision(d);
    dialog.current?.showModal();
  }

  function confirm() {
    if (!decision) return;
    start(async () => {
      const result = await decideCoachApplication(application.id, decision, {
        note, profileReviewed, qualificationsReviewed: qualifications,
      });
      if (!result.ok) {
        setError(result.message ?? t.admin.common.loadError);
        dialog.current?.close();
        return;
      }
      dialog.current?.close();
      setNote("");
      setProfileReviewed(false);
      setQualifications(false);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 text-[13.5px]" data-testid="admin-application" data-status={s} data-legacy={application.legacy}>
      <p className="text-ink-soft">{m.intro}</p>
      {application.legacy ? (
        <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-warn" data-testid="admin-application-legacy">
          <span className="font-semibold">{m.legacy}.</span> {m.legacyHint}
        </p>
      ) : null}
      {application.missing.length ? (
        <p className="text-warn">
          {application.missing_specializations?.length
            ? fill(m.missingDisciplines, { list: application.missing_specializations
                .map((slug) => { const sp = application.specializations.find((x) => x.slug === slug); return sp ? (locale === "ro" ? sp.name_ro : sp.name_en) : slug; })
                .join(", ") })
            : fill(m.missing, { list: application.missing.map((c) => m.missingCodes[c]).join(", ") })}
        </p>
      ) : null}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.evidence}</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {application.specializations.map((sp) => (
            <li key={sp.slug} className={`rounded-full px-3 py-1 text-[12px] font-semibold ${sp.qualification_evidence === "required" ? "bg-warn-soft text-warn" : "bg-bg text-ink-soft"}`}>
              {locale === "ro" ? sp.name_ro : sp.name_en} · {m.evidenceLevels[sp.qualification_evidence]}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.documents}</p>
        <p className="mt-0.5 text-[12px] text-ink-faint">{m.privateHint}</p>
        {application.documents.length === 0 ? <p className="mt-1.5 text-ink-soft">{m.noDocuments}</p> : (
          <ul className="mt-1.5 grid gap-1.5" data-testid="admin-application-documents">
            {application.documents.map((d) => {
              const spec = application.specializations.find((x) => x.slug === d.specialization);
              // left from before 20261119100000: not reviewed, not opened here, only listed so it can be removed
              const legacyIdentity = isLegacyIdentityDocument(d);
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg px-3.5 py-2.5" data-testid="admin-application-document" data-status={d.status}>
                  <span className="min-w-0">
                    <span className="block font-semibold">{m.docKinds[d.kind]}{d.label ? ` — ${d.label}` : ""}</span>
                    <span className="block text-[12px] text-ink-faint">
                      {[spec ? (locale === "ro" ? spec.name_ro : spec.name_en) : null, d.format.toUpperCase(), formatBytes(d.bytes, locale),
                        fmt[d.created_at], legacyIdentity ? null : m.docStatuses[d.status]].filter(Boolean).join(" · ")}
                    </span>
                    {d.review_note ? <span className="block text-[12px] text-ink-soft">{d.review_note}</span> : null}
                    {legacyIdentity ? <span className="block text-[12px] text-warn" data-testid="admin-document-identity-legacy">{m.identityLegacy}</span> : null}
                  </span>
                  {legacyIdentity ? null : <span className="flex flex-wrap items-center gap-2">
                    <a href={`/api/coach-documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-accent-ink hover:underline">{m.view}</a>
                    <a href={`/api/coach-documents/${d.id}?download=1`} className="text-[13px] font-semibold text-ink-soft hover:underline">{m.download}</a>
                    {d.status !== "accepted" ? (
                      <ConfirmAction tone="accent" label={m.accept} title={m.acceptTitle} body={m.acceptBody}
                        action={setVerificationDocumentStatus.bind(null, d.id, "accepted")} />
                    ) : null}
                    {d.status !== "rejected" ? (
                      <ConfirmAction tone="neutral" withReason label={m.rejectDoc} title={m.rejectDocTitle} body={m.rejectDocBody}
                        action={setVerificationDocumentStatus.bind(null, d.id, "rejected")} />
                    ) : null}
                  </span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {options.length ? (
        <div className="grid gap-3 rounded-2xl border border-line p-3.5" data-testid="admin-application-decide">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.checklist}</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={profileReviewed} onChange={(e) => setProfileReviewed(e.target.checked)} data-testid="admin-profile-reviewed" />
            <span>{m.profileReviewed}</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={qualifications} onChange={(e) => setQualifications(e.target.checked)} data-testid="admin-qualifications-reviewed" />
            <span>{m.qualificationsReviewed}</span>
          </label>
          <label className="grid gap-1">
            <span className="text-[12px] font-semibold text-ink-soft">{m.note}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} placeholder={m.notePlaceholder}
              className="rounded-xl border border-line bg-bg px-3 py-2 text-[13.5px] text-ink outline-none focus:border-accent" data-testid="admin-application-note" />
          </label>
          <div className="flex flex-wrap gap-2">
            {options.map((d) => (
              <button key={d} type="button" disabled={pending || (d === "approved" && !canApprove)} onClick={() => ask(d)} data-testid={`admin-decide-${d}`}
                className={`inline-flex h-9 items-center rounded-xl px-3.5 text-[12.5px] font-bold disabled:opacity-50 ${
                  d === "approved" ? "bg-accent text-accent-fg" : d === "changes_requested" ? "bg-surface text-ink-soft hover:text-ink" : "bg-risk-soft text-risk"}`}>
                {label[d]}
              </button>
            ))}
          </div>
          {error ? <p role="alert" className="text-[13px] text-risk">{error}</p> : null}
        </div>
      ) : null}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.history}</p>
        {application.history.length === 0 ? <p className="mt-1.5 text-ink-soft">{m.noHistory}</p> : (
          <ol className="mt-1.5 grid gap-1.5" data-testid="admin-application-history">
            {application.history.map((h, i) => (
              <li key={i}>
                <span className="font-semibold">{m.decisions[h.decision]}</span>
                <span className="text-ink-faint"> · {fmt[h.created_at]} · {fill(m.by, { name: h.actor ?? m.system })}</span>
                {h.decision === "approved" ? (
                  <span className="block text-[12px] text-ink-faint">
                    {fill(m.checked, { profile: h.profile_reviewed ? m.yes : m.no, qualifications: h.qualifications_reviewed ? m.yes : m.no })}
                    {h.identity_reviewed ? ` · ${m.checkedIdentityLegacy}` : ""}
                  </span>
                ) : null}
                {h.note ? <span className="block whitespace-pre-line text-ink-soft">{h.note}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <dialog ref={dialog} className="glass glass--strong fixed inset-0 z-50 m-auto h-fit w-[min(28rem,calc(100vw-2rem))] rounded-3xl p-0 text-ink backdrop:bg-bg/70">
        <form method="dialog" className="p-5" onSubmit={(e) => { e.preventDefault(); confirm(); }}>
          <h2 className="font-display text-lg font-extrabold tracking-tight">{decision ? fill(title[decision], { name }) : ""}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{decision ? body[decision] : ""}</p>
          {decision && note.trim() ? <p className="mt-2 whitespace-pre-line rounded-2xl bg-bg px-3 py-2 text-[13px]">{note.trim()}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="inline-flex h-9 items-center rounded-xl bg-surface px-3.5 text-[12.5px] font-bold text-ink-soft" onClick={() => dialog.current?.close()}>
              {m.cancel}
            </button>
            <button type="submit" disabled={pending} className="inline-flex h-9 items-center rounded-xl bg-accent px-3.5 text-[12.5px] font-bold text-accent-fg disabled:opacity-50" data-testid="admin-decide-confirm">
              {m.confirm}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
