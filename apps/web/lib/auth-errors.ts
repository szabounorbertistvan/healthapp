import type { AuthError } from "@supabase/supabase-js";

/**
 * Keys into `t.login` for the auth errors a user can actually cause. Supabase
 * returns English prose; the page shows the locale's version instead.
 *
 * Matched on the stable `code` first and the message as a fallback, because
 * older GoTrue versions (and the local stack, depending on the CLI) return
 * some of these without a code.
 */
export type AuthErrorKey =
  | "errInvalidCredentials"
  | "errEmailNotConfirmed"
  | "errEmailTaken"
  | "errRateLimited"
  | "errWeakPassword"
  | "errGeneric";

export function authErrorKey(error: Pick<AuthError, "message" | "code"> | null): AuthErrorKey {
  if (!error) return "errGeneric";
  const code = error.code ?? "";
  const msg = error.message.toLowerCase();

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "errInvalidCredentials";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "errEmailNotConfirmed";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "errEmailTaken";
  if (code.startsWith("over_") || code === "too_many_requests" || msg.includes("rate limit")) return "errRateLimited";
  if (code === "weak_password" || msg.includes("password should")) return "errWeakPassword";
  return "errGeneric";
}
