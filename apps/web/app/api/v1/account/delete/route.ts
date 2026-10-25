import type { WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { requestAccountDeletion } from "@/app/profile-actions";

// Delete this account — the web's requestAccountDeletion() (GDPR art. 17): the
// profile is anonymised and coaching ends now; the rows are erased by purgeAfter.
// The app asks for "DELETE" typed first, as the web does, then signs out.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (!b || typeof b.confirm !== "string" || b.confirm.trim().toUpperCase() !== "DELETE") {
    return apiJson<WriteResultV1>({ ok: false, message: "confirm" }, 400);
  }
  const result = await requestAccountDeletion();
  return apiJson<WriteResultV1 & { purgeAfter?: string }>({ ok: result.ok, message: result.message, purgeAfter: result.purgeAfter });
});
