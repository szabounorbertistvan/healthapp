// One post picture, delivered by this app instead of by Cloudinary.
//
// The token (lib/media-token.ts) was minted during a render, for a picture
// the reader's own RPC returned — so it already carries the answer to "may
// they see this post". It names one public_id and one of the fixed sizes and
// expires within ten minutes. Here it is only checked, never trusted further:
// a bad, tampered or expired token is a 404, the same as a missing picture.
// The middleware in front of every /api route also requires a session, so a
// copied link is useless to someone who is not signed in at all. The Android
// app has no cookies: it sends its access token as `Authorization: Bearer …`
// on the image request, the middleware lets only such a request through, and
// the token is verified here (lib/supabase/bearer.ts, as /api/v1 does) before
// anything is fetched — a token that does not verify is the same 404.
//
// The Cloudinary address is built and fetched server-side; the browser never
// sees it (it would be a permanent key — signed Cloudinary URLs do not
// expire). The response is cached privately by the browser until the token's
// own expiry, never by a shared cache.
import { NextResponse } from "next/server";
import { postMediaSourceUrl, verifyPostMediaToken } from "@/lib/cloudinary";
import { defaultLocale } from "@/lib/i18n";
import { withBearer } from "@/lib/supabase/bearer";
import { currentUserId } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE = /^image\/(jpeg|png|webp|avif)$/;

function notFound() {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claim = verifyPostMediaToken(token);
  if (!claim) return notFound();

  // The app's request (see the note above): the middleware passed it on the
  // header alone, so the token must belong to a live account before we go on.
  const header = request.headers.get("authorization");
  if (header !== null) {
    const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const userId = bearer ? await withBearer({ token: bearer, locale: defaultLocale }, () => currentUserId()) : null;
    if (!userId) return notFound();
  }

  let upstream: Response;
  try {
    upstream = await fetch(postMediaSourceUrl(claim.publicId, claim.variant), {
      cache: "no-store",
      // fetch_format=auto answers with AVIF / WebP when the browser takes them.
      headers: { Accept: request.headers.get("accept") ?? "image/*" },
    });
  } catch {
    return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (upstream.status === 404) return notFound();
  const type = (upstream.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!upstream.ok || !upstream.body || !IMAGE.test(type)) {
    return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const maxAge = Math.max(0, claim.expiresAt - Math.floor(Date.now() / 1000));
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": `private, max-age=${maxAge}`,
    Vary: "Accept",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new NextResponse(upstream.body, { status: 200, headers });
}
