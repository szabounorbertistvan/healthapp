import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeWithLink } from "@/lib/email-unsubscribe";

// RFC 8058 one-click unsubscribe: the List-Unsubscribe header of every
// marketplace email points here, and Gmail / Yahoo / Apple Mail POST
// "List-Unsubscribe=One-Click" without showing a page. The signed query
// string is the proof (email_unsubscribe(), 20261115100000).
export async function POST(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const outcome = await unsubscribeWithLink({ u: q.get("u"), c: q.get("c"), t: q.get("t") });
  if (outcome === "failed") return new NextResponse(null, { status: 503 });
  if (outcome === "invalid") return new NextResponse(null, { status: 400 });
  return new NextResponse(null, { status: 200 });
}

// A person who opens this URL in a browser gets the page with a button —
// never a change on GET, which link scanners and prefetchers also send.
export function GET(request: NextRequest) {
  const target = new URL("/unsubscribe", request.url);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 303);
}
