import { v1Route } from "@/lib/api/v1";
import { GET as reportFile } from "@/app/api/reports/[file]/route";

// The report file itself for the app — the web's /api/reports/[file] run under
// the app's bearer token: the same file, the same plan gate, the same reads.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const file = decodeURIComponent(new URL(request.url).pathname.split("/").at(-1) ?? "");
  return reportFile(request, { params: Promise.resolve({ file }) });
});
