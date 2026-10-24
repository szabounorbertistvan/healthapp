import type { CodedResultV1, SaveAccountV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { updateAccount } from "@/app/profile-actions";

// Save the profile form — the web's updateAccount(input, baseline): the same
// checks (name, username format and availability, zone, units), and only the
// fields that changed since the form was shown are written.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Partial<SaveAccountV1> | null;
  if (!b || !b.input || typeof b.input !== "object") return apiJson<CodedResultV1>({ ok: false, errorCode: "INVALID_INPUT" }, 400);
  const result = await updateAccount(b.input, b.baseline);
  return apiJson<CodedResultV1>({ ok: result.ok, message: result.message, errorCode: result.errorCode });
});
