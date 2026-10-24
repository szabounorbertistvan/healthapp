import type { ReviewCheckInV1, WriteResultV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { reviewCheckIn } from "@/app/actions";

// Mark a check-in reviewed, with optional feedback — the web's reviewCheckIn(),
// which proves the pairing through RLS before anything is filed.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<ReviewCheckInV1> | null;
  if (!b || typeof b.checkInId !== "string" || typeof b.clientId !== "string") {
    return apiJson<WriteResultV1>({ ok: false, message: "invalid" }, 400);
  }
  const result = await reviewCheckIn(b.checkInId, b.clientId, typeof b.feedback === "string" ? b.feedback : "");
  return apiJson<WriteResultV1>({ ok: result.ok, message: result.message });
});
