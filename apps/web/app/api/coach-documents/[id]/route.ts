// One coach verification document (20261118100000), delivered by this app.
//
// Who may read it is the database's answer, not this file's: the row is read
// with the caller's own session, and coach_verification_documents' only
// policy shows a row to the coach who owns it and to an admin. Anyone else —
// signed out, another coach, a client — gets the same 404 as a missing file.
//
// The file itself is fetched server-side through a five-minute signed
// Cloudinary download link; the browser never sees that link or the storage
// path. Never cached anywhere, sandboxed, and nothing about the document is
// logged. `?download=1` asks for an attachment instead of an inline view.
//
// Voinic no longer collects identity documents (20261119100000). One left from
// before is served to its owner only (so they can see what they are deleting),
// never to an admin: it is not part of any review.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { coachDocumentDownloadUrl } from "@/lib/cloudinary";
import { uuidOf } from "@/lib/admin/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
};

const NO_STORE = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };

function notFound() {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = uuidOf((await params).id);
  if (!id) return notFound();
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return notFound();
  const { data } = await supabase
    .from("coach_verification_documents").select("storage_public_id, format, kind, coach_profile_id").eq("id", id).maybeSingle();
  const row = data as { storage_public_id: string; format: string; kind: string; coach_profile_id: string } | null;
  const type = row ? TYPES[row.format] : undefined;
  if (!row || !type) return notFound();
  if (row.kind === "identity") {
    const { data: own } = await supabase
      .from("coach_profiles").select("id").eq("id", row.coach_profile_id).eq("user_id", auth.user.id).maybeSingle();
    if (!own) return notFound();
  }

  let upstream: Response;
  try {
    upstream = await fetch(coachDocumentDownloadUrl(row.storage_public_id, row.format), { cache: "no-store" });
  } catch {
    return new NextResponse(null, { status: 502, headers: NO_STORE });
  }
  if (upstream.status === 404) return notFound();
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502, headers: NO_STORE });

  // HEIC has no viewer in most browsers: always a download. Anything else inline only on request.
  const download = new URL(request.url).searchParams.get("download") === "1" || row.format === "heic";
  const headers = new Headers({
    ...NO_STORE,
    "Content-Type": type,
    // a neutral file name: the stored name says nothing, and the label stays in the app
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="document.${row.format}"`,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
  });
  // an image cannot run anything, but say so; a sandboxed PDF would not open in Chrome's viewer at all,
  // and the type is ours (never the upstream's), so nothing else can be served as a page here
  if (type !== "application/pdf") headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  // a PDF opens in the browser's own viewer, top-level only: no other page may frame it
  else headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new NextResponse(upstream.body, { status: 200, headers });
}
