import type { CodedResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { acceptInvite } from "@/app/client-actions";

// "I have a code" — claim a coach's invite (accept_invite()). The refusal comes
// back as its business code (INVALID_CODE / EXPIRED / ALREADY_HAS_COACH /
// CLIENT_LIMIT_REACHED / UNKNOWN); the app pairs it with its own copy.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const r = await acceptInvite(typeof b?.code === "string" ? b.code : "");
  return apiJson<CodedResultV1>({ ok: r.ok, errorCode: r.errorCode });
});
