// Verifying DishFinder's signed recipe hand-off (packages/shared/src/recipe-handoff.ts
// has the format and the reasons). Server-only: the shared secret never reaches
// a browser. DISHFINDER_HANDOFF_SECRET here must equal VOINIC_HANDOFF_SECRET on
// DishFinder's server.
import { createHmac, timingSafeEqual } from "node:crypto";
import { HANDOFF_CONTEXT, HANDOFF_MAX_PAYLOAD, parseHandoff, type HandoffError, type RecipeHandoff } from "@healthapp/shared";

/** The pending hand-off rides in this cookie from the form post, across sign-in, to the dialog. */
export const HANDOFF_COOKIE = "vi_recipe_handoff";

export type HandoffResult = { ok: true; handoff: RecipeHandoff } | { ok: false; error: HandoffError | "HANDOFF_SIGNATURE" | "HANDOFF_NOT_CONFIGURED" };

function secret(): string | null {
  const s = process.env.DISHFINDER_HANDOFF_SECRET?.trim() ?? "";
  return s.length >= 32 ? s : null;
}

/** base64url(HMAC-SHA256(secret, context + payload)). Exported for tests and tooling. */
export function signHandoff(payload: string, key: string): string {
  return createHmac("sha256", key).update(HANDOFF_CONTEXT + payload).digest("base64url");
}

/** Signature, then size, then shape and age — in that order, so nothing unsigned is ever parsed. */
export function verifyHandoff(payload: string, signature: string, nowS = Math.floor(Date.now() / 1000), key = secret()): HandoffResult {
  if (!key) return { ok: false, error: "HANDOFF_NOT_CONFIGURED" };
  if (!payload || !signature || payload.length > HANDOFF_MAX_PAYLOAD || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return { ok: false, error: payload.length > HANDOFF_MAX_PAYLOAD ? "HANDOFF_TOO_LARGE" : "HANDOFF_SIGNATURE" };
  }
  const expected = Buffer.from(signHandoff(payload, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, error: "HANDOFF_SIGNATURE" };
  return parseHandoff(Buffer.from(payload, "base64url").toString("utf8"), nowS);
}

/** The cookie value is "<payload>.<signature>" — both base64url, so the dot is unambiguous. */
export function verifyHandoffCookie(value: string | undefined, nowS?: number, key?: string | null): HandoffResult {
  const [p = "", s = ""] = (value ?? "").split(".");
  return verifyHandoff(p, s, nowS, key === undefined ? secret() : key);
}
