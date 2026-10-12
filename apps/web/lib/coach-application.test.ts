import { describe, expect, it } from "vitest";
import {
  COACH_DOCUMENT_KINDS, COACH_DOCUMENT_MAX_BYTES, applicationState, checkDocumentFile, checkStoredDocument, disciplinesToEvidence,
  formatBytes, isLegacyIdentityDocument,
} from "./coach-application";

const USER = "11111111-2222-3333-4444-555555555555";
const ID = `voinic/coach-docs/${USER}/0123456789abcdef`;

describe("applicationState", () => {
  it("reads a returned draft by the reason it came back", () => {
    expect(applicationState("draft", null)).toBe("draft");
    expect(applicationState("draft", "changes_requested")).toBe("more_info_required");
    expect(applicationState("draft", "rejected")).toBe("rejected");
    expect(applicationState("draft", "revoked")).toBe("revoked");
  });
  it("names the live and review states", () => {
    expect(applicationState("pending_review", null)).toBe("pending_review");
    expect(applicationState("published", null)).toBe("approved");
    expect(applicationState("hidden", null)).toBe("hidden");
    expect(applicationState("suspended", "revoked")).toBe("suspended");
  });
});

describe("checkDocumentFile (before upload)", () => {
  it("takes PDFs and the image formats", () => {
    expect(checkDocumentFile({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(checkDocumentFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkDocumentFile({ type: "image/heic", size: 1000 })).toBeNull();
    // some browsers give HEIC no type; the extension decides then
    expect(checkDocumentFile({ type: "", size: 1000, name: "id.HEIC" })).toBeNull();
  });
  it("refuses other types, empty files and anything over the cap", () => {
    expect(checkDocumentFile({ type: "text/html", size: 1000, name: "x.html" })).toBe("BAD_TYPE");
    expect(checkDocumentFile({ type: "image/svg+xml", size: 1000, name: "x.svg" })).toBe("BAD_TYPE");
    expect(checkDocumentFile({ type: "application/zip", size: 1000, name: "x.pdf.zip" })).toBe("BAD_TYPE");
    expect(checkDocumentFile({ type: "application/pdf", size: 0 })).toBe("EMPTY");
    expect(checkDocumentFile({ type: "application/pdf", size: COACH_DOCUMENT_MAX_BYTES })).toBeNull();
    expect(checkDocumentFile({ type: "application/pdf", size: COACH_DOCUMENT_MAX_BYTES + 1 })).toBe("TOO_LARGE");
  });
});

describe("checkStoredDocument (after upload, from Cloudinary)", () => {
  it("accepts what was signed for this user", () => {
    expect(checkStoredDocument({ public_id: ID, format: "pdf", bytes: 2000 }, USER, ID)).toBeNull();
    expect(checkStoredDocument({ public_id: ID, format: "PNG", bytes: 2000 }, USER, ID)).toBeNull();
  });
  it("refuses another user's folder, a different id, an unknown format or size", () => {
    const other = "99999999-2222-3333-4444-555555555555";
    expect(checkStoredDocument({ public_id: ID, format: "pdf", bytes: 2000 }, other, ID)).toBe("BAD_TYPE");
    expect(checkStoredDocument({ public_id: `${ID}x`, format: "pdf", bytes: 2000 }, USER, ID)).toBe("BAD_TYPE");
    expect(checkStoredDocument(null, USER, ID)).toBe("BAD_TYPE");
    expect(checkStoredDocument({ public_id: ID, format: "svg", bytes: 2000 }, USER, ID)).toBe("BAD_TYPE");
    expect(checkStoredDocument({ public_id: ID, format: "pdf", bytes: 0 }, USER, ID)).toBe("EMPTY");
    expect(checkStoredDocument({ public_id: ID, format: "pdf", bytes: COACH_DOCUMENT_MAX_BYTES + 1 }, USER, ID)).toBe("TOO_LARGE");
  });
});

describe("helpers", () => {
  const yoga = { slug: "yoga", name_en: "Yoga", name_ro: "Yoga" };
  const box = { slug: "boxing", name_en: "Boxing", name_ro: "Box" };
  it("names the disciplines still waiting for a qualification, in the server's order", () => {
    expect(disciplinesToEvidence({ missing: ["QUALIFICATION_DOCUMENT"], required_specializations: [yoga, box], missing_specializations: ["boxing"] }))
      .toEqual([box]);
    // an older server that only says "missing": every required discipline
    expect(disciplinesToEvidence({ missing: ["QUALIFICATION_DOCUMENT"], required_specializations: [yoga, box] })).toEqual([yoga, box]);
    expect(disciplinesToEvidence({ missing: [], required_specializations: [yoga], missing_specializations: [] })).toEqual([]);
  });
  it("never offers an identity document, and treats one on file as something to remove", () => {
    expect(COACH_DOCUMENT_KINDS).toEqual(["qualification", "other"]);
    expect((COACH_DOCUMENT_KINDS as readonly string[]).includes("identity")).toBe(false);
    expect(isLegacyIdentityDocument({ kind: "identity" })).toBe(true);
    expect(isLegacyIdentityDocument({ kind: "qualification" })).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatBytes(10 * 1024 * 1024, "en")).toBe("10 MB");
    expect(formatBytes(340 * 1024, "en")).toBe("340 KB");
    expect(formatBytes(1536 * 1024, "ro")).toBe("1,5 MB");
  });
});
