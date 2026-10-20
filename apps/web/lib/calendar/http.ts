/**
 * One place where a provider's HTTP answer becomes a CalendarProviderError
 * code. Never the provider's text: only the status (and Retry-After) is read,
 * so nothing a provider says about an event can reach a log or the database.
 */
import type { CalendarErrorCode } from "@healthapp/shared";
import { CalendarProviderError } from "./provider";

export function errorForStatus(status: number, retryAfter: string | null, onToken = false): CalendarProviderError {
  const retry = retryAfter && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : null;
  let code: CalendarErrorCode;
  if (onToken && (status === 400 || status === 401)) code = "token_revoked"; // invalid_grant: the refresh token is gone
  else if (status === 401) code = "token_expired";
  else if (status === 403) code = "permission_denied";
  else if (status === 404 || status === 410) code = "calendar_not_found";
  else if (status === 429) code = "rate_limited";
  else if (status >= 500) code = "provider_unavailable";
  else code = "unknown";
  return new CalendarProviderError(code, retry);
}

/** fetch → JSON, or a CalendarProviderError; a network failure is "provider_unavailable". */
export async function providerJson<T>(url: string, init: RequestInit, onToken = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new CalendarProviderError("provider_unavailable", 60);
  }
  if (!res.ok) throw errorForStatus(res.status, res.headers.get("retry-after"), onToken);
  return (await res.json()) as T;
}

export function form(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  };
}

/** The email in an OpenID id_token's payload, for the account label. The token came straight from the provider over TLS. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const email = payload.email ?? payload.preferred_username ?? payload.upn;
    return typeof email === "string" ? email.slice(0, 200) : null;
  } catch {
    return null;
  }
}
