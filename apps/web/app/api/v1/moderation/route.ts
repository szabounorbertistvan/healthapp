import type { WriteResultV1 } from "@healthapp/api/v1";
import type { ReportTarget } from "@healthapp/shared";
import { apiJson, v1Route } from "@/lib/api/v1";
import { reportContent, setBlocked, setMuted } from "@/app/moderation-actions";

// The ••• menu's moves — the web's moderation actions: mute / unmute, block /
// unblock, report (a post, comment, review, coach profile or person, with a
// reason from the fixed list). The database decides each.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const r =
    b?.op === "mute" ? await setMuted(str(b.userId), b.on === true)
    : b?.op === "block" ? await setBlocked(str(b.userId), b.on === true)
    : b?.op === "report" ? await reportContent(str(b.kind) as ReportTarget, str(b.targetId), str(b.reason), str(b.details))
    : null;
  if (!r) return apiJson<WriteResultV1>({ ok: false, message: "invalid" }, 400);
  return apiJson<WriteResultV1>({ ok: r.ok, message: r.message });
});
