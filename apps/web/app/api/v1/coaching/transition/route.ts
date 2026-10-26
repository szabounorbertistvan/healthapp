import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { transitionCoaching } from "@/app/coaching-actions";

// One move in a coaching relationship — pause, resume or end, from either
// side (components/coaching-lifecycle.tsx). coaching_transition() decides.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { relationshipId?: unknown; to?: unknown; reason?: unknown } | null;
  const r = await transitionCoaching({
    relationshipId: b?.relationshipId as string, to: b?.to as "paused" | "active" | "ended", reason: (b?.reason ?? null) as string | null,
  });
  return apiJson<CodedResultV1>({ ok: r.ok, message: r.message, errorCode: r.errorCode });
});
