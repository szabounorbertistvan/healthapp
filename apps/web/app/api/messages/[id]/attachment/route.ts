// The picture or voice note of one message (20261207130000), delivered by this app.
//
// Who may hear or see it is the database's answer: the message row is read with
// the caller's own session, so msg_select shows it only to the two people in the
// conversation. Anyone else — signed out, another coach — gets the same 404 as a
// missing file. The file is fetched server-side through a five-minute signed
// Cloudinary link the browser never sees, and never cached outside the browser.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { messageAttachmentDownloadUrl, type MessageAttachmentKind } from "@/lib/cloudinary";
import { uuidOf } from "@/lib/admin/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
  webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", aac: "audio/aac",
};
const HEADERS = { "Cache-Control": "private, max-age=600", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

function notFound() {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuidOf((await params).id);
  if (!id) return notFound();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("messages").select("attachment_kind, attachment_path, attachment_format").eq("id", id).maybeSingle();
  const row = data as { attachment_kind: MessageAttachmentKind | null; attachment_path: string | null; attachment_format: string | null } | null;
  const type = row?.attachment_format ? TYPES[row.attachment_format] : undefined;
  if (!row?.attachment_kind || !row.attachment_path || !row.attachment_format || !type) return notFound();

  let upstream: Response;
  try {
    upstream = await fetch(messageAttachmentDownloadUrl(row.attachment_path, row.attachment_format, row.attachment_kind), { cache: "no-store" });
  } catch {
    return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (upstream.status === 404) return notFound();
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(upstream.body, {
    status: 200,
    headers: { ...HEADERS, "Content-Type": type, "Content-Disposition": "inline", ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length")! } : {}) },
  });
}
