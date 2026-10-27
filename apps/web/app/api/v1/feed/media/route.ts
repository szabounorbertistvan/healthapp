import type { MediaTicketsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { discardPostMedia, requestPostMediaUploads } from "@/app/social-actions";

// Pictures for a post, before the post exists — the composer's own actions:
// tickets (one signed Cloudinary upload per picture, private, up to ten) and
// discard (the author's never-used uploads, when a picture is removed or the
// composer closes). The post itself names the uploads it keeps.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { op?: unknown; count?: unknown; publicIds?: unknown } | null;
  if (b?.op === "tickets") {
    const r = await requestPostMediaUploads(typeof b.count === "number" ? b.count : 0);
    return apiJson<MediaTicketsV1>({ ok: r.ok, message: r.message, tickets: r.tickets });
  }
  if (b?.op === "discard") {
    const r = await discardPostMedia(Array.isArray(b.publicIds) ? b.publicIds.filter((x): x is string => typeof x === "string") : []);
    return apiJson<MediaTicketsV1>({ ok: r.ok, message: r.message });
  }
  return apiJson<MediaTicketsV1>({ ok: false, message: "invalid" }, 400);
});
