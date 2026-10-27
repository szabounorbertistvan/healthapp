import type { CompleteProfileV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { acceptConsent, completeProfile } from "@/app/profile-actions";
import type { Sex } from "@/lib/types";

// The app's complete-profile step — the web's /complete-profile form: an
// account with no username (a Google sign-up) gives its name, username, sex,
// age and role, or an existing one records the current consent. The actions
// validate everything; claim_signup_role() honours the role only once.
export const dynamic = "force-dynamic";

export const POST = v1Route(async (request) => {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (b?.op === "consent") return apiJson<CompleteProfileV1>(await acceptConsent());
  if (b?.op !== "complete") return apiJson<CompleteProfileV1>({ ok: false, message: "invalid" }, 400);
  return apiJson<CompleteProfileV1>(await completeProfile({
    fullName: str(b.fullName),
    username: str(b.username),
    sex: str(b.sex) as Sex,
    age: typeof b.age === "number" ? b.age : NaN,
    role: b.role === "coach" ? "coach" : "client",
  }));
});
