import { v1Route } from "@/lib/api/v1";
import { GET as coachDocument } from "@/app/api/coach-documents/[id]/route";

// One of the coach's own qualification documents for the app — the web's
// /api/coach-documents/[id] run under the app's bearer token: the same row
// read with the caller's session, the same 404 for anyone else, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  return coachDocument(request, { params: Promise.resolve({ id }) });
});
