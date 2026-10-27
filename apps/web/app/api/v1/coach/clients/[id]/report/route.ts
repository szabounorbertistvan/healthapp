import { v1Route } from "@/lib/api/v1";
import { GET as clientReport } from "@/app/api/clients/[id]/report/route";

// A client's progress PDF for their coach, in the app — the web's
// /api/clients/[id]/report run under the app's bearer token: the same file,
// the same Coach Pro gate, the same roster check and reads.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").at(-2) ?? "");
  return clientReport(request, { params: Promise.resolve({ id }) });
});
