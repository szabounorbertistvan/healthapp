import type { CoachProfileWriteV1 } from "@healthapp/api/v1";
import {
  COACH_DOCUMENT_KINDS, COACH_DOCUMENT_MAX_BYTES, applicationState, checkDocumentFile, disciplinesToEvidence, formatBytes,
  isLegacyIdentityDocument, type ApplicationState, type CoachUploadKind, type MyCoachApplication,
} from "@healthapp/shared/coach/application";
import { credentialLabel, statusView, summary, verificationView } from "@healthapp/shared/coach/onboarding";
import type { CoachProfileRow, MyCoachProfile } from "@healthapp/shared/coach/profile";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Chip, ErrorText, Note, Pill, Primary, Section, Small, Tick, useCoachError, type Tone } from "@/components/coach-profile-bits";
import { Field, Hint, Switch } from "@/components/settings-forms";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { shareFile } from "@/lib/share-file";
import { font, useTheme } from "@/lib/theme";
import { uploadSigned } from "@/lib/upload";

// The cards above the coach-profile editor (components/coach-profile/status.tsx,
// verification.tsx, application.tsx): becoming a coach, where the profile
// stands with its moves (hide / show / edit, accepting clients), an open
// revision of a live profile, the application review with its private
// documents, and Voinic Verified. The database decides every transition.

/** One coach-profile write, then a fresh read of the page and the overview. */
export function useProfileWrite() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (op: string, body: Record<string, unknown> = {}): Promise<CoachProfileWriteV1 | Error> => {
    setBusy(true);
    try {
      return await api.coachProfileWrite(op, body);
    } catch (e) {
      return e instanceof Error ? e : new Error("failed");
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["coach-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["coach-marketplace"] });
      setBusy(false);
    }
  };
  return { run, busy };
}

const isOk = (r: CoachProfileWriteV1 | Error): r is CoachProfileWriteV1 & { ok: true } => !(r instanceof Error) && r.ok;

/** A coach account with no profile yet: become_coach() makes the draft. */
export function BecomeCoachCard() {
  const { t } = useI18n();
  const b = t.coachProfile.become;
  const { run, busy } = useProfileWrite();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card style={{ gap: 8 }}>
      <Section>{b.title}</Section>
      <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: useTheme().color.inkSoft }}>{b.body}</Text>
      <View style={{ alignSelf: "flex-start", marginTop: 6 }}>
        <Primary label={busy ? b.busy : b.button} busy={busy} onPress={async () => {
          setError(null);
          const r = await run("become");
          if (isOk(r)) return;
          const code = r instanceof Error ? null : r.errorCode;
          setError(code === "PROFILE_INCOMPLETE" ? b.errIncomplete : code === "ACCOUNT_UNAVAILABLE" ? b.errUnavailable : t.coachProfile.errors.generic);
        }} />
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

const TONES: Record<CoachProfileRow["status"], Tone> = { draft: "neutral", pending_review: "warn", published: "accent", hidden: "neutral", suspended: "risk" };

/** Where the profile stands (CoachProfileStatusPanel). */
export function StatusPanel({ profile, editing, showNote }: { profile: CoachProfileRow; editing: boolean; showNote: boolean }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.coachProfile.status;
  const coachError = useCoachError();
  const { run, busy } = useProfileWrite();
  const view = statusView(profile.status);
  const [accepting, setAccepting] = useState(profile.accepting_clients);
  const [confirm, setConfirm] = useState<"edit" | "hide" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = profile.status === "published" || profile.status === "hidden";
  const body = profile.status === "draft" ? s.draftBody : profile.status === "pending_review" ? s.pendingBody
    : profile.status === "published" ? s.publishedBody : profile.status === "hidden" ? s.hiddenBody : s.suspendedBody;

  async function act(op: string, after?: () => void) {
    setError(null);
    const r = await run(op);
    setConfirm(null);
    if (isOk(r)) return after?.();
    if (!(r instanceof Error) && r.missing?.length) {
      const groups = t.coachProfile.publish.groups;
      return setError(fill(s.showMissing, { list: summary(r.missing).filter((x) => !x.done).map((x) => groups[x.group]).join(", ") }));
    }
    setError(coachError(r));
  }

  async function toggleAccepting(next: boolean) {
    setError(null);
    setAccepting(next);
    const r = await run("draft", { fields: { acceptingClients: next } });
    if (!isOk(r)) {
      setAccepting(!next);
      setError(coachError(r));
    }
  }

  return (
    <Card style={{ gap: 0 }}>
      {/* a phone is too narrow for the pill and three buttons on one line: the buttons go under it */}
      <View style={{ gap: 10, alignItems: "flex-start" }}>
        <Pill label={s[profile.status]} tone={TONES[profile.status]} />
        <View style={{ alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {view.action === "view" ? <Small label={s.viewPublic} onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: profile.slug } })} /> : null}
          {profile.status === "published" ? <Small label={s.hide} disabled={busy} onPress={() => setConfirm("hide")} /> : null}
          {profile.status === "hidden" ? <Primary label={s.show} disabled={busy} onPress={() => void act("show")} /> : null}
          {(view.action === "edit" || view.action === "view") && !editing ? <Small label={s.edit} disabled={busy} onPress={() => setConfirm("edit")} /> : null}
        </View>
      </View>
      <Text style={{ marginTop: 12, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{body}</Text>
      {profile.status === "suspended" && profile.suspension_reason ? (
        <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.risk }}>{fill(s.suspendedReason, { reason: profile.suspension_reason })}</Text>
      ) : null}
      {showNote && profile.status === "draft" && profile.review_note ? <Note tone="warn">{fill(s.reviewNote, { note: profile.review_note })}</Note> : null}
      {profile.status === "pending_review" || live ? (
        <View style={{ marginTop: 14 }}>
          <Switch label={s.accepting} hint={s.acceptingHint} value={accepting} disabled={busy} onChange={(v) => void toggleAccepting(v)} onLabel={t.coachProfile.wizard.on} offLabel={t.coachProfile.wizard.off} />
        </View>
      ) : null}
      {confirm ? (
        // the web's dialogs, inline: the question, then the move or Cancel
        <View style={{ marginTop: 14, borderRadius: 16, padding: 14, backgroundColor: color.bg, gap: 10 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 15, color: color.ink }}>{confirm === "hide" ? s.hideTitle : s.editConfirmTitle}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>
            {confirm === "hide" ? s.hideBody : live ? s.editLiveConfirm : s.editPendingConfirm}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
            <Small label={s.cancel} onPress={() => setConfirm(null)} />
            <Primary label={confirm === "hide" ? s.hideConfirm : s.editConfirm} busy={busy}
              onPress={() => void act(confirm === "hide" ? "hide" : live ? "startRevision" : "withdraw")} />
          </View>
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

/** An open revision of a live profile (CoachRevisionBanner). */
export function RevisionBanner({ revision }: { revision: NonNullable<MyCoachProfile["revision"]> }) {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const r = t.coachProfile.status.revision;
  const coachError = useCoachError();
  const { run, busy } = useProfileWrite();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = revision.status === "pending_review" ? r.pending : revision.status === "rejected" ? r.rejected : r.editing;
  return (
    <Card style={{ gap: 0 }}>
      <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{r.title}</Text>
      <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{body}</Text>
      {revision.status === "rejected" && revision.review_note ? <Note tone="warn">{fill(r.note, { note: revision.review_note })}</Note> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ marginTop: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {confirm ? (
          <>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{r.discardConfirm}</Text>
            <Small label={r.discard} disabled={busy} onPress={async () => {
              const res = await run("discardRevision");
              if (!isOk(res)) setError(coachError(res));
              setConfirm(false);
            }} />
            <Text accessibilityRole="button" onPress={() => setConfirm(false)} style={{ paddingHorizontal: 8, fontFamily: font.semibold, fontSize: 15, color: color.inkFaint }}>✕</Text>
          </>
        ) : <Small label={r.discard} onPress={() => setConfirm(true)} />}
      </View>
    </Card>
  );
}

const APP_TONE: Record<ApplicationState, Tone> = {
  draft: "neutral", pending_review: "warn", more_info_required: "warn", rejected: "risk", revoked: "risk", approved: "accent", hidden: "neutral", suspended: "risk",
};

/** The application review and its private documents (CoachApplicationCard). */
export function ApplicationCard({ application, uploads, disciplines }: {
  application: MyCoachApplication;
  uploads: boolean;
  disciplines: { slug: string; name_en: string; name_ro: string }[];
}) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const a = t.coachProfile.application;
  const state = applicationState(application.status, application.review_decision);
  const toEvidence = disciplinesToEvidence(application);
  const legacy = (state === "approved" || state === "hidden") && !application.history.some((h) => h.decision === "approved");
  const showNote = application.review_note && (state === "more_info_required" || state === "rejected" || state === "revoked");
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <Card style={{ gap: 0 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{a.title}</Text>
        <Pill label={a.states[state]} tone={APP_TONE[state]} />
      </View>
      <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{a.stateBody[state]}</Text>
      {showNote ? (
        <Note tone="warn">{`${a.note}\n${application.review_note}`}</Note>
      ) : null}
      {legacy ? <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{a.legacyNote}</Text> : null}
      <Hint>{a.intro}</Hint>
      <Hint>{a.whatMeans}</Hint>
      {toEvidence.length > 0 ? (
        <View style={{ marginTop: 12, borderRadius: 16, padding: 12, backgroundColor: color.bg }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{a.needed}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>
            {fill(a.neededQualification, { list: toEvidence.map((s) => (locale === "ro" ? s.name_ro : s.name_en)).join(", ") })}
          </Text>
        </View>
      ) : null}
      <Documents application={application} uploads={uploads} disciplines={disciplines} />
      <View style={{ marginTop: 18 }}>
        <Section>{a.history}</Section>
        {application.history.length === 0 ? <Hint>{a.noHistory}</Hint> : application.history.map((h, i) => (
          <Text key={i} style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.inkSoft }}>
            <Text style={{ fontFamily: font.semibold, color: color.ink }}>{a.decisions[h.decision]}</Text>
            {` · ${date(h.created_at)}`}
            {h.note ? `\n${h.note}` : ""}
          </Text>
        ))}
      </View>
    </Card>
  );
}

function Documents({ application, uploads, disciplines }: {
  application: MyCoachApplication; uploads: boolean; disciplines: { slug: string; name_en: string; name_ro: string }[];
}) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const a = t.coachProfile.application;
  const coachError = useCoachError();
  const { run } = useProfileWrite();
  const [kind, setKind] = useState<CoachUploadKind>("qualification");
  // a discipline still waiting for evidence first: an untagged qualification does not count for a required one
  const [specialization, setSpecialization] = useState(() => disciplinesToEvidence(application)[0]?.slug ?? "");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const editable = application.documents_editable;
  const size = formatBytes(COACH_DOCUMENT_MAX_BYTES, locale);
  // the coach's own disciplines, the required ones first
  const specs = [...disciplines].sort((x, y) =>
    Number(application.required_specializations.some((r) => r.slug === y.slug)) - Number(application.required_specializations.some((r) => r.slug === x.slug)));

  async function upload() {
    setMessage(null);
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"], copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const f = res.assets[0];
    const check = checkDocumentFile({ type: f.mimeType ?? "", size: f.size ?? 0, name: f.name });
    if (check) return setMessage({ tone: "error", text: fill(a.errors[check], { size }) });
    setBusy(true);
    try {
      const ticket = await api.coachProfileWrite("documentTicket");
      if (!ticket.ok || !ticket.ticket) return setMessage({ tone: "error", text: coachError(ticket) });
      const stored = await uploadSigned(ticket.ticket, { uri: f.uri, name: f.name, type: f.mimeType ?? "application/octet-stream", size: f.size ?? null, file: f.file ?? null });
      if (!stored) return setMessage({ tone: "error", text: a.errors.upload });
      const saved = await run("saveDocument", {
        publicId: stored.publicId, kind, label: label.trim() || null,
        specialization: kind === "qualification" && specialization ? specialization : null,
      });
      if (!isOk(saved)) return setMessage({ tone: "error", text: coachError(saved) });
      setLabel("");
      setMessage({ tone: "ok", text: a.uploaded });
    } catch {
      setMessage({ tone: "error", text: a.errors.upload });
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string, format: string) {
    setMessage(null);
    try {
      const bytes = await api.coachDocument(id);
      const type = format === "pdf" ? "application/pdf" : `image/${format === "jpg" ? "jpeg" : format}`;
      await shareFile(`document.${format}`, bytes, type);
    } catch (e) {
      setMessage({ tone: "error", text: coachError(e) });
    }
  }

  async function remove(id: string) {
    setMessage(null);
    const r = await run("deleteDocument", { id });
    setConfirming(null);
    if (!isOk(r)) setMessage({ tone: "error", text: coachError(r) });
  }

  return (
    <View style={{ marginTop: 18 }}>
      <Section>{a.documents}</Section>
      {application.documents.length === 0 ? <Hint>{a.noDocuments}</Hint> : application.documents.map((doc) => {
        const legacyIdentity = isLegacyIdentityDocument(doc);
        const removable = legacyIdentity || (editable && !(doc.status === "accepted" && application.status !== "draft"));
        return (
          <View key={doc.id} style={{ marginTop: 8, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: color.bg }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{doc.label || a.kinds[doc.kind]}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
              {[a.kinds[doc.kind], doc.format.toUpperCase(), formatBytes(doc.bytes, locale), legacyIdentity ? null : a.docStatus[doc.status]].filter(Boolean).join(" · ")}
            </Text>
            {doc.review_note ? <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkSoft }}>{fill(a.docNote, { note: doc.review_note })}</Text> : null}
            {legacyIdentity ? <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.warn }}>{a.identityLegacy}</Text> : null}
            <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <Text accessibilityRole="link" onPress={() => void open(doc.id, doc.format)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{a.open}</Text>
              {removable ? (
                confirming === doc.id ? (
                  <>
                    <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{a.removeConfirm}</Text>
                    <Text accessibilityRole="button" onPress={() => void remove(doc.id)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.risk }}>{a.remove}</Text>
                    <Text accessibilityRole="button" onPress={() => setConfirming(null)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkFaint }}>{a.cancel}</Text>
                  </>
                ) : (
                  <Text accessibilityRole="button" onPress={() => setConfirming(doc.id)} style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{a.remove}</Text>
                )
              ) : null}
            </View>
          </View>
        );
      })}
      {editable && application.documents.some((d) => d.status === "accepted") && application.status !== "draft" ? <Hint>{a.acceptedLocked}</Hint> : null}
      {!editable ? <Hint>{a.locked}</Hint> : uploads ? (
        <View style={{ marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: color.line, padding: 14, gap: 10 }}>
          <View>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{a.kind}</Text>
            <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {COACH_DOCUMENT_KINDS.map((k) => <Chip key={k} on={kind === k} disabled={busy} label={a.kinds[k]} onPress={() => setKind(k)} />)}
            </View>
          </View>
          {kind === "qualification" && specs.length > 0 ? (
            <View>
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{a.discipline}</Text>
              <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Chip on={specialization === ""} disabled={busy} label={a.anyDiscipline} onPress={() => setSpecialization("")} />
                {specs.map((s) => <Chip key={s.slug} on={specialization === s.slug} disabled={busy} label={locale === "ro" ? s.name_ro : s.name_en} onPress={() => setSpecialization(s.slug)} />)}
              </View>
            </View>
          ) : null}
          <Hint>{a.kindHint[kind]}</Hint>
          <Field label={a.label} value={label} onChange={setLabel} maxLength={120} placeholder={a.labelPlaceholder} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <Small label={busy ? a.uploading : a.choose} disabled={busy} onPress={() => void upload()} />
            <Text style={{ flexShrink: 1, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{fill(a.formats, { size })}</Text>
          </View>
        </View>
      ) : <Hint>{t.coachProfile.errors.UPLOADS_UNAVAILABLE}</Hint>}
      {message ? (
        <Text accessibilityRole={message.tone === "error" ? "alert" : "text"} style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 13, color: message.tone === "error" ? color.risk : color.accentInk }}>{message.text}</Text>
      ) : null}
    </View>
  );
}

/** Voinic Verified: where the request stands and the one move a coach has (VerificationCard). */
export function VerificationCard({ data }: { data: MyCoachProfile }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const v = t.coachProfile.verification;
  const c = t.coachProfile.certifications;
  const groups = t.coachProfile.publish.groups;
  const coachError = useCoachError();
  const { run, busy } = useProfileWrite();
  const p = data.profile;
  const view = verificationView(p.verification_status);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = summary(data.missing).filter((x) => !x.done).map((x) => groups[x.group]);
  const complete = data.missing.length === 0;
  const today = new Date().toISOString().slice(0, 10);
  const date = (iso: string | null) => iso ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "";
  const credentialStatus = (s: string) => s === "verified" ? c.statusVerified : s === "pending" ? c.statusPending : s === "rejected" ? c.statusRejected : c.statusUnverified;

  async function ask() {
    setError(null);
    const r = await run("verification", { message });
    if (isOk(r)) return setMessage("");
    if (!(r instanceof Error) && r.missing?.length) {
      return setError(fill(v.missing, { list: summary(r.missing).filter((x) => !x.done).map((x) => groups[x.group]).join(", ") }));
    }
    setError(coachError(r));
  }

  return (
    <Card style={{ gap: 0 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink }}>{v.title}</Text>
        <Pill label={p.verification_status === "verified" ? `✓ ${v.badge}` : v.statuses[p.verification_status]} tone={view.tone} />
      </View>
      <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{v.bodies[p.verification_status]}</Text>
      {p.verification_status === "pending" && p.verification_requested_at ? <Hint>{fill(v.requestedOn, { date: date(p.verification_requested_at) })}</Hint> : null}
      {p.verification_status === "rejected" && p.verification_note ? <Note tone="risk">{fill(v.reason, { note: p.verification_note })}</Note> : null}
      {view.canRequest ? (
        <View style={{ marginTop: 14, gap: 6 }}>
          <Section>{v.requirements}</Section>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Tick done={complete} />
            <Text style={{ fontFamily: font.regular, fontSize: 14, color: complete ? color.ink : color.inkSoft }}>{v.reqProfile}</Text>
            {!complete ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`— ${open.join(", ")}`}</Text> : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Tick done={data.certifications.length > 0} optional />
            <Text style={{ fontFamily: font.regular, fontSize: 14, color: data.certifications.length ? color.ink : color.inkSoft }}>{v.reqCredentials}</Text>
            {data.certifications.length ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{`— ${fill(v.reqCredentialsCount, { n: data.certifications.length })}`}</Text> : null}
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: 14 }}>
        <Section>{v.submitted}</Section>
        {data.certifications.length === 0 ? <Hint>{v.noCredentials}</Hint> : data.certifications.map((cert) => {
          const label = credentialLabel(cert, today);
          return (
            <View key={cert.id} style={{ marginTop: 6, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: color.bg, gap: 6 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{cert.name}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
                {[cert.issuer, cert.year, cert.credential_number ? fill(c.numberShort, { n: cert.credential_number }) : null, cert.expires_on ? fill(c.expiresShort, { date: cert.expires_on }) : null].filter(Boolean).join(" · ")}
              </Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {label.expired ? <Pill label={c.expired} tone="risk" /> : null}
                <Pill label={credentialStatus(cert.verification_status)} tone={cert.verification_status === "verified" ? "accent" : cert.verification_status === "pending" ? "warn" : cert.verification_status === "rejected" ? "risk" : "neutral"} />
              </View>
            </View>
          );
        })}
        {p.status !== "draft" ? <Hint>{v.credentialsLocked}</Hint> : null}
      </View>
      {view.canRequest && p.status !== "suspended" ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <Field label={v.message} value={message} onChange={setMessage} multiline maxLength={1000} />
          <Hint>{v.messageHint}</Hint>
          <View style={{ alignSelf: "flex-start" }}>
            <Primary label={busy ? v.requesting : p.verification_status === "rejected" ? v.requestAgain : v.request} busy={busy} disabled={!complete} onPress={() => void ask()} />
          </View>
        </View>
      ) : null}
      <Hint>{v.intro}</Hint>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}
