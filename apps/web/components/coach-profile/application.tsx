"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  COACH_DOCUMENT_ACCEPT, COACH_DOCUMENT_KINDS, COACH_DOCUMENT_MAX_BYTES, applicationState, checkDocumentFile, documentsToAdd,
  formatBytes, type ApplicationState, type CoachDocument, type CoachDocumentKind, type MyCoachApplication,
} from "@/lib/coach-application";
import { uploadSignedImage } from "@/lib/cloudinary-upload";
import { deleteCoachDocument, requestCoachDocumentUpload, saveCoachDocument } from "@/app/coach-document-actions";
import { FIELD, HINT, LABEL, SMALL_BUTTON } from "@/lib/form-classes";
import { Card } from "../ui";
import { useCoachError } from "./status";

const TONE: Record<ApplicationState, string> = {
  draft: "bg-bg text-ink-soft",
  pending_review: "bg-warn-soft text-warn",
  more_info_required: "bg-warn-soft text-warn",
  rejected: "bg-risk-soft text-risk",
  revoked: "bg-risk-soft text-risk",
  approved: "bg-accent-soft text-accent-ink",
  hidden: "bg-bg text-ink-soft",
  suspended: "bg-risk-soft text-risk",
};

/**
 * The coach's side of the application review (20261118100000): where it
 * stands, the reviewer's note, the private documents and what happened so
 * far. Everything here is the coach's own — coach_my_application() leaves
 * out storage paths and reviewer ids — and a document opens through
 * /api/coach-documents/[id], which re-asks the database who may read it.
 */
export function CoachApplicationCard({ application, uploads, disciplines }: {
  application: MyCoachApplication;
  uploads: boolean;
  /** The coach's own specializations, for tying a qualification to one. */
  disciplines: { slug: string; name_en: string; name_ro: string }[];
}) {
  const { t, locale } = useI18n();
  const a = t.coachProfile.application;
  const state = applicationState(application.status, application.review_decision);
  const toAdd = documentsToAdd(application);
  const legacy = (state === "approved" || state === "hidden") && !application.history.some((h) => h.decision === "approved");
  const showNote = application.review_note && (state === "more_info_required" || state === "rejected" || state === "revoked");
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <Card plain>
      <section aria-labelledby="coach-application" data-testid="coach-application" data-state={state}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="coach-application" className="font-display text-lg font-bold tracking-tight">{a.title}</h2>
          <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${TONE[state]}`} data-testid="coach-application-state">
            {a.states[state]}
          </span>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{a.stateBody[state]}</p>
        {showNote ? (
          <div className="mt-3 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13.5px] leading-relaxed text-warn" data-testid="coach-application-note">
            <p className="font-semibold">{a.note}</p>
            <p className="mt-0.5 whitespace-pre-line">{application.review_note}</p>
          </div>
        ) : null}
        {legacy ? <p className="mt-2 text-[13px] text-ink-soft">{a.legacyNote}</p> : null}
        <p className={`${HINT} mt-2`}>{a.intro}</p>
        <p className={`${HINT} mt-1`}>{a.whatMeans}</p>

        {toAdd.length > 0 ? (
          <div className="mt-4 rounded-2xl bg-bg px-3.5 py-3 text-[13.5px]" data-testid="coach-application-needed">
            <p className="font-semibold">{a.needed}</p>
            <ul className="mt-1 list-disc pl-5 text-ink-soft">
              {toAdd.includes("IDENTITY_DOCUMENT") ? <li>{a.neededIdentity}</li> : null}
              {toAdd.includes("QUALIFICATION_DOCUMENT") ? (
                <li>{fill(a.neededQualification, {
                  list: application.required_specializations.map((s) => (locale === "ro" ? s.name_ro : s.name_en)).join(", "),
                })}</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <Documents application={application} uploads={uploads} disciplines={disciplines} />

        <div className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{a.history}</h3>
          {application.history.length === 0 ? <p className={`${HINT} mt-1.5`}>{a.noHistory}</p> : (
            <ol className="mt-1.5 grid gap-1.5" data-testid="coach-application-history">
              {application.history.map((h, i) => (
                <li key={i} className="text-[13px]">
                  <span className="font-semibold">{a.decisions[h.decision]}</span>
                  <span className="text-ink-faint"> · {date(h.created_at)}</span>
                  {h.note ? <span className="block whitespace-pre-line text-ink-soft">{h.note}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </Card>
  );
}

function Documents({ application, uploads, disciplines }: {
  application: MyCoachApplication; uploads: boolean; disciplines: { slug: string; name_en: string; name_ro: string }[];
}) {
  const { t, locale } = useI18n();
  const a = t.coachProfile.application;
  const router = useRouter();
  const coachError = useCoachError();
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const editable = application.documents_editable;
  const [kind, setKind] = useState<CoachDocumentKind>(
    application.missing.includes("IDENTITY_DOCUMENT") ? "identity" : application.missing.includes("QUALIFICATION_DOCUMENT") ? "qualification" : "identity");
  const [specialization, setSpecialization] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const size = formatBytes(COACH_DOCUMENT_MAX_BYTES, locale);
  // the ones that need evidence first
  const required = new Set(application.required_specializations.map((s) => s.slug));
  const specs = [...disciplines].sort((x, y) => Number(required.has(y.slug)) - Number(required.has(x.slug)));

  async function upload(file: File) {
    setMessage(null);
    const check = checkDocumentFile(file);
    if (check) {
      setMessage({ tone: "error", text: fill(a.errors[check], { size }) });
      return;
    }
    setBusy(true);
    try {
      const ticket = await requestCoachDocumentUpload();
      if (!ticket.ok || !ticket.ticket) {
        setMessage({ tone: "error", text: coachError(ticket) });
        return;
      }
      const stored = await uploadSignedImage(ticket.ticket, file);
      if (!stored) {
        setMessage({ tone: "error", text: a.errors.upload });
        return;
      }
      const saved = await saveCoachDocument({
        publicId: stored.publicId, kind, label: label.trim() || null,
        specialization: kind === "qualification" && specialization ? specialization : null,
      });
      if (!saved.ok) {
        setMessage({ tone: "error", text: coachError(saved) });
        return;
      }
      setLabel("");
      setMessage({ tone: "ok", text: a.uploaded });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: a.errors.upload });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(doc: CoachDocument) {
    setMessage(null);
    start(async () => {
      const result = await deleteCoachDocument(doc.id);
      setConfirming(null);
      if (!result.ok) {
        setMessage({ tone: "error", text: coachError(result) });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{a.documents}</h3>
      {application.documents.length === 0 ? <p className={`${HINT} mt-1.5`}>{a.noDocuments}</p> : (
        <ul className="mt-1.5 grid gap-1.5" data-testid="coach-documents">
          {application.documents.map((doc) => {
            const removable = editable && !(doc.status === "accepted" && application.status !== "draft");
            return (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg px-3.5 py-2.5 text-[13px]"
                data-testid="coach-document" data-kind={doc.kind} data-status={doc.status}>
                <span className="min-w-0">
                  <span className="block font-semibold">{doc.label || a.kinds[doc.kind]}</span>
                  <span className="block text-[12px] text-ink-faint">
                    {[a.kinds[doc.kind], doc.format.toUpperCase(), formatBytes(doc.bytes, locale), a.docStatus[doc.status]].join(" · ")}
                  </span>
                  {doc.review_note ? <span className="block text-[12px] text-ink-soft">{fill(a.docNote, { note: doc.review_note })}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <a href={`/api/coach-documents/${doc.id}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-accent-ink hover:underline">
                    {a.open}
                  </a>
                  {removable ? (
                    confirming === doc.id ? (
                      <>
                        <button type="button" className="text-[13px] font-semibold text-risk hover:underline" disabled={pending} onClick={() => remove(doc)}>
                          {a.removeConfirm}
                        </button>
                        <button type="button" className="text-[13px] text-ink-faint hover:underline" onClick={() => setConfirming(null)}>{a.cancel}</button>
                      </>
                    ) : (
                      <button type="button" className="text-[13px] font-semibold text-ink-soft hover:text-risk" onClick={() => setConfirming(doc.id)}>
                        {a.remove}
                      </button>
                    )
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editable && application.documents.some((d) => d.status === "accepted") && application.status !== "draft" ? (
        <p className={`${HINT} mt-1.5`}>{a.acceptedLocked}</p>
      ) : null}

      {!editable ? <p className={`${HINT} mt-3`} data-testid="coach-documents-locked">{a.locked}</p> : uploads ? (
        <div className="mt-4 grid gap-3 rounded-2xl border border-line p-3.5" data-testid="coach-document-upload">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className={LABEL}>{a.kind}</span>
              <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as CoachDocumentKind)} disabled={busy}>
                {COACH_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{a.kinds[k]}</option>)}
              </select>
            </label>
            {kind === "qualification" && specs.length > 0 ? (
              <label className="grid gap-1">
                <span className={LABEL}>{a.discipline}</span>
                <select className={FIELD} value={specialization} onChange={(e) => setSpecialization(e.target.value)} disabled={busy}>
                  <option value="">{a.anyDiscipline}</option>
                  {specs.map((s) => <option key={s.slug} value={s.slug}>{locale === "ro" ? s.name_ro : s.name_en}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          <p className={HINT}>{a.kindHint[kind]}</p>
          <label className="grid gap-1">
            <span className={LABEL}>{a.label}</span>
            <input className={FIELD} value={label} maxLength={120} placeholder={a.labelPlaceholder} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef} id={`${ids}-file`} type="file" accept={COACH_DOCUMENT_ACCEPT} className="sr-only" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} data-testid="coach-document-file"
            />
            <label htmlFor={`${ids}-file`} className={`${SMALL_BUTTON} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
              {busy ? a.uploading : a.choose}
            </label>
            <span className={HINT}>{fill(a.formats, { size })}</span>
          </div>
        </div>
      ) : (
        <p className={`${HINT} mt-3`}>{t.coachProfile.errors.UPLOADS_UNAVAILABLE}</p>
      )}
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-[13px] ${message.tone === "error" ? "text-risk" : "text-accent-ink"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
