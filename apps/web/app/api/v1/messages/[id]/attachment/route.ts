import { v1Route } from "@/lib/api/v1";
import { GET as messageAttachment } from "@/app/api/messages/[id]/attachment/route";

// The picture or voice note of one message for the app — the web's
// /api/messages/[id]/attachment run under the app's bearer token: the message
// row read with the caller's session (only the two people in the conversation
// see it), the file fetched through a short-lived signed link the app never sees.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const parts = new URL(request.url).pathname.split("/");
  const id = decodeURIComponent(parts.at(-2) ?? "");
  return messageAttachment(request, { params: Promise.resolve({ id }) });
});
