"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { liveUser } from "@/lib/supabase/server";
import { notSignedIn } from "@/lib/action-result";
import { id, parseInput } from "@/lib/validate";
import { coachProfileErrorCode } from "@/lib/coach-profile";
import { COACH_DOCUMENT_KINDS, checkStoredDocument } from "@/lib/coach-application";
import {
  CloudinaryNotConfiguredError, coachDocumentFolder, destroyCoachDocument, lookupCoachDocument, signCoachDocumentUpload,
  type AvatarUploadTicket,
} from "@/lib/cloudinary";
import type { ActionResult } from "./actions";

// A coach's verification documents (20261118100000): qualification evidence
// (and other supporting documents) for the admin who reviews the application.
// Voinic does not collect identity documents (20261119100000): this file
// offers no way to add one, and the database refuses one anyway. Private
// end to end — an authenticated Cloudinary upload into a folder only this
// server names, a public_id the database re-checks against the caller, read
// back only through /api/coach-documents/[id] (owner or admin, a five-minute
// signed link). Nothing about a document — its id, name or kind — is logged.

function failure(error: { message: string }): ActionResult {
  const code = coachProfileErrorCode(error);
  return { ok: false, errorCode: code ?? undefined, message: code ? undefined : "Could not save the document" };
}

function revalidate() {
  revalidatePath("/settings", "layout");
  revalidatePath("/admin/coaches", "layout");
  revalidatePath("/admin/coach-applications");
}

/** A signed ticket for one new file: a fresh opaque name in the caller's own folder. */
export async function requestCoachDocumentUpload(): Promise<ActionResult & { ticket?: AvatarUploadTicket }> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  // Only a coach whose application takes documents now gets a ticket: no profile, in review or
  // suspended means nothing could be recorded, and the upload would only leave a stray file.
  const { data: app, error } = await live.supabase.rpc("coach_my_application");
  if (error) return failure(error);
  if (!app) return { ok: false, errorCode: "NO_COACH_PROFILE" };
  if (!(app as { documents_editable?: boolean }).documents_editable) return { ok: false, errorCode: "DOCUMENTS_LOCKED" };
  try {
    return { ok: true, ticket: signCoachDocumentUpload(live.userId, randomBytes(16).toString("hex")) };
  } catch (error) {
    if (error instanceof CloudinaryNotConfiguredError) return { ok: false, errorCode: "UPLOADS_UNAVAILABLE" };
    throw error;
  }
}

/**
 * Records an upload. What counts is what Cloudinary stored (its format and
 * size), not what the browser said; a file that fails the check, or that the
 * database refuses, is deleted again so nothing unrecorded stays in storage.
 */
export async function saveCoachDocument(input: {
  publicId: string; kind: (typeof COACH_DOCUMENT_KINDS)[number]; label?: string | null; specialization?: string | null;
}): Promise<ActionResult> {
  const parsed = await parseInput(z.object({
    publicId: z.string().max(200),
    kind: z.enum(COACH_DOCUMENT_KINDS),
    label: z.string().trim().max(120).nullable().optional(),
    specialization: z.string().max(80).nullable().optional(),
  }).strict(), input);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { publicId, kind, label, specialization } = parsed.data;
  if (!publicId.startsWith(`${coachDocumentFolder(live.userId)}/`)) return { ok: false, errorCode: "BAD_DOCUMENT_PATH" };

  let asset;
  try {
    asset = await lookupCoachDocument(publicId);
  } catch (error) {
    if (error instanceof CloudinaryNotConfiguredError) return { ok: false, errorCode: "UPLOADS_UNAVAILABLE" };
    throw error;
  }
  const discard = () => destroyCoachDocument(publicId).catch(() => console.error("coach document not removed after a refused upload"));
  const check = checkStoredDocument(asset, live.userId, publicId);
  if (check) {
    await discard();
    return { ok: false, errorCode: check === "TOO_LARGE" ? "DOCUMENT_TOO_LARGE" : "BAD_DOCUMENT" };
  }
  const { error } = await live.supabase.rpc("coach_add_verification_document", {
    p_kind: kind, p_public_id: publicId, p_format: asset!.format!.toLowerCase(), p_bytes: asset!.bytes!,
    p_label: label || null, p_specialization: specialization || null,
  });
  if (error) {
    // 23505: this name is already on record (a ticket used twice) — the file is that record's
    // evidence, possibly accepted, and must not be deleted from under it
    if (error.code !== "23505") await discard();
    return failure(error);
  }
  revalidate();
  return { ok: true };
}

/** Removes the row (the database says whether the application still allows it), then the file. */
export async function deleteCoachDocument(documentId: string): Promise<ActionResult> {
  const parsed = await parseInput(id, documentId);
  if (!parsed.ok) return parsed.result;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data, error } = await live.supabase.rpc("coach_remove_verification_document", { p_document: parsed.data });
  if (error) return failure(error);
  // The row is the record; a failed Cloudinary call must not undo the removal.
  if (typeof data === "string" && data) {
    try {
      await destroyCoachDocument(data);
    } catch {
      console.error("coach document file not removed");
    }
  }
  revalidate();
  return { ok: true };
}
