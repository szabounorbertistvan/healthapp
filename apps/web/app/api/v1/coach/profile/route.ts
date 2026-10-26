import type { CoachProfileEditorV1, CoachProfileWriteV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import {
  becomeCoach, deleteCoachCertification, deleteCoachService, discardCoachRevision, hideCoachProfile, removeCover,
  reorderCoachServices, requestCoachVerification, requestCoverUpload, saveCoachCertification, saveCoachProfileDraft,
  saveCoachService, saveCover, setCoachLanguages, setCoachLocations, setCoachServiceActive, setCoachSpecializations,
  showCoachProfile, startCoachRevision, submitCoachForReview, withdrawCoachProfile,
  type CoachCertificationInput, type CoachDraftFields, type CoachServiceInput,
} from "@/app/coach-profile-actions";
import { deleteCoachDocument, requestCoachDocumentUpload, saveCoachDocument } from "@/app/coach-document-actions";
import { removeAvatar, requestAvatarUpload, saveAvatar } from "@/app/profile-actions";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { displayName, getProfile } from "@/lib/data";
import { getCoachCatalog, getMyCoachApplication, getMyCoachProfile } from "@/lib/coach-profile-data";

// The coach's own Coach Discovery profile — the web's /settings/coach-profile:
// GET reads what that page reads (the profile with every list, the catalog,
// the application review); POST makes one of its writes through the same
// actions (op = become | draft | specializations | languages | locations |
// service | deleteService | reorderServices | serviceActive | certification |
// deleteCertification | coverTicket | saveCover | removeCover | avatarTicket |
// saveAvatar | removeAvatar | documentTicket | saveDocument | deleteDocument |
// submit | withdraw | hide | show | startRevision | discardRevision |
// verification). The actions validate every input (zod, strict); this only routes.
export const dynamic = "force-dynamic";

export const GET = v1Route(async () => {
  const [profile, mine, catalog, application] = await Promise.all([getProfile(), getMyCoachProfile(), getCoachCatalog(), getMyCoachApplication()]);
  return apiJson<CoachProfileEditorV1>({
    mine,
    catalog,
    application,
    display_name: displayName(profile),
    avatar_url: profile?.avatar_url ?? null,
    uploads: cloudinaryConfigured(),
  });
});

type Body = Record<string, unknown> & { op?: unknown };
type Result = { ok: boolean; message?: string; errorCode?: string; id?: string; missing?: CoachProfileWriteV1["missing"]; ticket?: CoachProfileWriteV1["ticket"] };

async function write(b: Body): Promise<Result | null> {
  switch (b.op) {
    case "become": return becomeCoach();
    case "draft": return saveCoachProfileDraft((b.fields ?? {}) as CoachDraftFields);
    case "specializations": return setCoachSpecializations(b.slugs as string[], (b.primary ?? null) as string | null);
    case "languages": return setCoachLanguages(b.codes as string[]);
    case "locations": return setCoachLocations(b.locations as Parameters<typeof setCoachLocations>[0]);
    case "service": return saveCoachService(b.service as CoachServiceInput);
    case "deleteService": return deleteCoachService(b.id as string);
    case "reorderServices": return reorderCoachServices(b.ids as string[]);
    case "serviceActive": return setCoachServiceActive(b.id as string, b.active as boolean);
    case "certification": return saveCoachCertification(b.certification as CoachCertificationInput);
    case "deleteCertification": return deleteCoachCertification(b.id as string);
    case "coverTicket": return requestCoverUpload();
    case "saveCover": return saveCover({ publicId: b.publicId as string, version: b.version as number });
    case "removeCover": return removeCover();
    case "avatarTicket": return requestAvatarUpload();
    case "saveAvatar": return saveAvatar({ publicId: b.publicId as string, version: b.version as number });
    case "removeAvatar": return removeAvatar();
    case "documentTicket": return requestCoachDocumentUpload();
    case "saveDocument": return saveCoachDocument({
      publicId: b.publicId as string, kind: b.kind as "qualification" | "other",
      label: (b.label ?? null) as string | null, specialization: (b.specialization ?? null) as string | null,
    });
    case "deleteDocument": return deleteCoachDocument(b.id as string);
    case "submit": return submitCoachForReview();
    case "withdraw": return withdrawCoachProfile();
    case "hide": return hideCoachProfile();
    case "show": return showCoachProfile();
    case "startRevision": return startCoachRevision();
    case "discardRevision": return discardCoachRevision();
    case "verification": return requestCoachVerification((b.message ?? "") as string);
    default: return null;
  }
}

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Body | null;
  const r = b ? await write(b) : null;
  if (!r) return apiJson<CoachProfileWriteV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  return apiJson<CoachProfileWriteV1>({
    ok: r.ok, message: r.message, errorCode: r.errorCode, id: r.id, missing: r.missing,
    ...(r.ticket ? { ticket: { cloudName: r.ticket.cloudName, apiKey: r.ticket.apiKey, fields: r.ticket.fields } } : {}),
  });
});
