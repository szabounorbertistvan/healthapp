"use server";
// A picture or a voice note in a coach–client conversation (20261207130000).
//
// 1. requestMessageUpload: the server checks the caller is in the
//    conversation (RLS on conversations answers), mints a random public_id in
//    the sender's own folder of that conversation and signs a Cloudinary upload
//    for exactly that id — authenticated, never overwritable.
// 2. The browser posts the file straight to Cloudinary (no server body limit).
// 3. sendMessageWithAttachment: what Cloudinary stored is looked up here (format,
//    bytes, length) — never taken from the browser — and only then is the row
//    written; msg_insert / conversation_open and messages_attachment_guard
//    decide the rest. A refused or unusable upload is deleted again.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { notSignedIn } from "@/lib/action-result";
import { liveUser } from "@/lib/supabase/server";
import {
  cloudinaryConfigured, destroyMessageAttachment, lookupMessageAttachment, messageFolder, signMessageUpload,
  MESSAGE_ATTACHMENT_MAX_BYTES, MESSAGE_AUDIO_FORMATS, MESSAGE_IMAGE_FORMATS, type MessageAttachmentKind,
} from "@/lib/cloudinary";
import { id, parseInput, text } from "@/lib/validate";
import type { ActionResult } from "./actions";

export type MessageUploadTicket = {
  cloudName: string; apiKey: string; resourceType: "image" | "video"; fields: Record<string, string>; publicId: string;
};

const RequestInput = z.object({ conversationId: id, kind: z.enum(["image", "audio"]) });

export async function requestMessageUpload(input: z.input<typeof RequestInput>): Promise<ActionResult & { ticket?: MessageUploadTicket }> {
  const parsed = await parseInput(RequestInput, input);
  if (!parsed.ok) return parsed.result;
  if (!cloudinaryConfigured()) return { ok: false, message: "NOT_CONFIGURED" };
  const live = await liveUser();
  if (!live) return notSignedIn;
  const { data: conv } = await live.supabase.from("conversations").select("id").eq("id", parsed.data.conversationId).maybeSingle();
  if (!conv) return { ok: false, errorCode: "NO_ROWS" };
  const name = randomBytes(15).toString("hex").slice(0, 24); // [a-z0-9]{24}, what the database accepts
  const ticket = signMessageUpload(parsed.data.conversationId, live.userId, name, parsed.data.kind);
  return { ok: true, ticket: { ...ticket, publicId: `${messageFolder(parsed.data.conversationId, live.userId)}/${name}` } };
}

const SendInput = z.object({
  conversationId: id,
  body: text(4000).nullable(),
  attachment: z.object({ kind: z.enum(["image", "audio"]), publicId: z.string().max(200) }),
});

export async function sendMessageWithAttachment(input: z.input<typeof SendInput>): Promise<ActionResult> {
  const parsed = await parseInput(SendInput, input);
  if (!parsed.ok) return parsed.result;
  const v = parsed.data;
  const live = await liveUser();
  if (!live) return notSignedIn;
  const kind: MessageAttachmentKind = v.attachment.kind;
  const folder = `${messageFolder(v.conversationId, live.userId)}/`;
  if (!v.attachment.publicId.startsWith(folder) || !/^[a-z0-9]{20,40}$/.test(v.attachment.publicId.slice(folder.length))) {
    return { ok: false, errorCode: "INVALID_INPUT" };
  }

  const stored = await lookupMessageAttachment(v.attachment.publicId, kind);
  const formats: readonly string[] = kind === "audio" ? MESSAGE_AUDIO_FORMATS : MESSAGE_IMAGE_FORMATS;
  const usable = stored && formats.includes(stored.format) && stored.bytes > 0 && stored.bytes <= MESSAGE_ATTACHMENT_MAX_BYTES
    && (kind !== "audio" || (typeof stored.duration === "number" && stored.duration > 0 && stored.duration <= 300));
  if (!stored || !usable) {
    if (stored) await destroyMessageAttachment(v.attachment.publicId, kind);
    return { ok: false, message: "ATTACHMENT_REFUSED" };
  }

  const { error } = await live.supabase.from("messages").insert({
    conversation_id: v.conversationId,
    sender_id: live.userId,
    body: v.body?.trim() || null,
    attachment_kind: kind,
    attachment_path: v.attachment.publicId,
    attachment_bytes: stored.bytes,
    attachment_format: stored.format,
    attachment_seconds: kind === "audio" ? Math.round((stored.duration ?? 0) * 10) / 10 : null,
    attachment_width: kind === "image" ? stored.width ?? null : null,
    attachment_height: kind === "image" ? stored.height ?? null : null,
  });
  if (error) {
    await destroyMessageAttachment(v.attachment.publicId, kind);
    if (error.code === "42501") return { ok: false, errorCode: "CONVERSATION_CLOSED", message: "CONVERSATION_CLOSED" };
    return { ok: false, message: error.message };
  }
  revalidatePath(`/messages/${v.conversationId}`);
  revalidatePath(`/coach/messages/${v.conversationId}`);
  return { ok: true };
}

/** An upload the person abandoned (closed the preview, recording discarded) is deleted at once. */
export async function discardMessageUpload(conversationId: string, publicId: string, kind: MessageAttachmentKind): Promise<ActionResult> {
  const live = await liveUser();
  if (!live) return notSignedIn;
  if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !publicId.startsWith(`${messageFolder(conversationId, live.userId)}/`)) {
    return { ok: false, errorCode: "INVALID_INPUT" };
  }
  // a file already sent belongs to its message: only an unsent upload is discarded
  const { data: sent } = await live.supabase.from("messages").select("id").eq("attachment_path", publicId).maybeSingle();
  if (sent) return { ok: false, errorCode: "INVALID_INPUT" };
  await destroyMessageAttachment(publicId, kind === "audio" ? "audio" : "image");
  return { ok: true };
}
