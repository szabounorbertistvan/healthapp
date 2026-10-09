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
  | "errEmailRateLimited"
  | "errEmailRateLimitedIn"
  | "errWeakPassword"
  | "errGeneric";

export function authErrorKey(error: Pick<AuthError, "message" | "code"> | null): AuthErrorKey {
  if (!error) return "errGeneric";
  const code = error.code ?? "";
  const msg = error.message.toLowerCase();

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "errInvalidCredentials";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "errEmailNotConfirmed";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "errEmailTaken";
  // The two rate limits are worth telling apart. `over_email_send_rate_limit`
  // is the mailer's cap — two an hour on Supabase's built-in SMTP, counted per
  // project, not per person — so "wait a minute" is a lie there; it also
  // carries the exact wait in its prose. Everything else in the `over_*`
  // family is the per-IP request bucket, which really does clear in minutes.
  if (code === "over_email_send_rate_limit" || msg.includes("only request this after")) {
    return retryAfterSeconds(error) === null ? "errEmailRateLimited" : "errEmailRateLimitedIn";
  }
  if (code.startsWith("over_") || code === "too_many_requests" || msg.includes("rate limit")) return "errRateLimited";
  if (code === "weak_password" || msg.includes("password should")) return "errWeakPassword";
  return "errGeneric";
}

/**
 * The wait GoTrue quotes in "For security purposes, you can only request this
 * after 51 seconds." Returns null when the message does not carry one, which
 * is why `errEmailRateLimited` exists alongside the `{seconds}` variant.
 */
export function retryAfterSeconds(error: Pick<AuthError, "message"> | null): number | null {
  const match = error?.message.match(/after (\d+) seconds?/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * The single call every auth surface makes: pick the key, then fill in the
 * wait if the key is the one that has a `{seconds}` slot.
 */
export function authErrorMessage(
  error: Pick<AuthError, "message" | "code"> | null,
  strings: Record<AuthErrorKey, string>,
): string {
  const key = authErrorKey(error);
  if (key !== "errEmailRateLimitedIn") return strings[key];
  return strings[key].replace("{seconds}", String(retryAfterSeconds(error) ?? 0));
}

/** Seconds the resend button stays disabled after a send, so a click cannot loop. */
export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendOutcome = { kind: "sent" } | { kind: "error"; key: AuthErrorKey };

/**
 * What the "resend confirmation email" button shows after `auth.resend()`.
 * Only two things are worth telling the person: a rate limit (they should
 * wait, and how long when GoTrue says) and a request that never reached the
 * server (they should retry). Every other answer, success included, reads the
 * same neutral "if there is an unconfirmed account…" — an error about this
 * particular address would say whether it has an account.
 */
export function resendOutcome(
  error: (Pick<AuthError, "message" | "code"> & { name?: string; status?: number }) | null,
): ResendOutcome {
  if (!error) return { kind: "sent" };
  const key = authErrorKey(error);
  if (key === "errRateLimited" || key === "errEmailRateLimited" || key === "errEmailRateLimitedIn") {
    return { kind: "error", key };
  }
  // supabase-js reports a failed fetch as AuthRetryableFetchError, status 0
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || /failed to fetch|network/i.test(error.message)) {
    return { kind: "error", key: "errGeneric" };
  }
  return { kind: "sent" };
}
