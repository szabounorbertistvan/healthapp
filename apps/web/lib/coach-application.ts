/**
 * Coach applications (migration 20261118100000) for the web app. Pure and
 * client-safe. The database decides — coach_add_verification_document()
 * re-checks every limit here, admin_decide_coach_application() is the only
 * way to approve — this file mirrors the limits so the page can say so before
 * a round trip, and names the states the way people read them.
 */
import type { CoachProfileStatus } from "./coach-profile";

export const COACH_DOCUMENT_KINDS = ["identity", "qualification", "other"] as const;
export type CoachDocumentKind = (typeof COACH_DOCUMENT_KINDS)[number];

/** The formats Cloudinary is told to accept and the database checks again. */
export const COACH_DOCUMENT_FORMATS = ["pdf", "jpg", "jpeg", "png", "webp", "heic"] as const;
export type CoachDocumentFormat = (typeof COACH_DOCUMENT_FORMATS)[number];
export const COACH_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const COACH_DOCUMENT_MAX_COUNT = 12;
/** What the file picker offers. */
export const COACH_DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";

export type CoachDocumentStatus = "submitted" | "accepted" | "rejected";
export type ReviewDecision = "changes_requested" | "rejected" | "revoked";

export type CoachDocument = {
  id: string; kind: CoachDocumentKind; label: string | null; specialization: string | null;
  format: CoachDocumentFormat; bytes: number; status: CoachDocumentStatus; review_note: string | null; created_at: string;
};

export type ApplicationHistoryEntry = {
  decision: "submitted" | "approved" | "changes_requested" | "rejected" | "revoked" | "legacy_approved";
  note: string | null;
  created_at: string;
};

/** coach_my_application(): the coach's own view, without storage handles or reviewer ids. */
export type MyCoachApplication = {
  status: CoachProfileStatus;
  review_decision: ReviewDecision | null;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  missing: ApplicationMissing[];
  documents_editable: boolean;
  required_specializations: { slug: string; name_en: string; name_ro: string }[];
  documents: CoachDocument[];
  history: ApplicationHistoryEntry[];
};

export type ApplicationMissing = "IDENTITY_DOCUMENT" | "QUALIFICATION_DOCUMENT";

/**
 * The application as a person reads it — the five states of the review plus
 * the two a live profile can be in. A profile sent back stays a draft in the
 * lifecycle; `review_decision` says why.
 */
export type ApplicationState =
  | "draft" | "pending_review" | "more_info_required" | "rejected" | "revoked" | "approved" | "hidden" | "suspended";

export function applicationState(status: CoachProfileStatus, decision: ReviewDecision | null): ApplicationState {
  switch (status) {
    case "pending_review": return "pending_review";
    case "published": return "approved";
    case "hidden": return "hidden";
    case "suspended": return "suspended";
    case "draft":
      return decision === "changes_requested" ? "more_info_required" : decision === "rejected" ? "rejected" : decision === "revoked" ? "revoked" : "draft";
  }
}

export type DocumentCheck = "BAD_TYPE" | "TOO_LARGE" | "EMPTY" | null;

const MIME_FORMAT: Record<string, CoachDocumentFormat> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
};

/** Before upload, from what the browser knows; the server checks the stored asset again. */
export function checkDocumentFile(file: { type: string; size: number; name?: string }): DocumentCheck {
  if (file.size <= 0) return "EMPTY";
  const ext = file.name?.split(".").pop()?.toLowerCase() ?? "";
  const known = MIME_FORMAT[file.type] ?? ((COACH_DOCUMENT_FORMATS as readonly string[]).includes(ext) ? ext : null);
  if (!known) return "BAD_TYPE";
  if (file.size > COACH_DOCUMENT_MAX_BYTES) return "TOO_LARGE";
  return null;
}

/** After upload, from what Cloudinary stored: the format and size it read, the folder it was signed for. */
export function checkStoredDocument(asset: { public_id?: string; format?: string; bytes?: number } | null, userId: string, publicId: string): DocumentCheck {
  if (!asset || asset.public_id !== publicId || !publicId.startsWith(`voinic/coach-docs/${userId}/`)) return "BAD_TYPE";
  if (!asset.format || !(COACH_DOCUMENT_FORMATS as readonly string[]).includes(asset.format.toLowerCase())) return "BAD_TYPE";
  if (!asset.bytes || asset.bytes <= 0) return "EMPTY";
  if (asset.bytes > COACH_DOCUMENT_MAX_BYTES) return "TOO_LARGE";
  return null;
}

/** "1.2 MB" / "340 KB" */
export function formatBytes(bytes: number, locale: "en" | "ro"): string {
  const nf = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
  return bytes >= 1024 * 1024 ? `${nf.format(bytes / 1024 / 1024)} MB` : `${nf.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** What the coach still has to add before they can submit (the server's list, ordered for reading). */
export function documentsToAdd(app: Pick<MyCoachApplication, "missing">): ApplicationMissing[] {
  return (["IDENTITY_DOCUMENT", "QUALIFICATION_DOCUMENT"] as const).filter((m) => app.missing.includes(m));
}
