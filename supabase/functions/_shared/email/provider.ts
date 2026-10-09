// The email provider, isolated behind one small interface so it can be swapped.
//
// Resend is the candidate (docs/MARKETPLACE_EMAIL.md). Nothing here runs unless
// the dispatcher is configured: readEmailConfig() refuses to return a config
// with a missing value, and the only thing it ever reports is the *names* of
// what is missing — never a value. The API key is read from the function's
// environment (Supabase Secrets) and is never logged, returned or thrown.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key → the provider sends at most once, whatever the retries. */
  idempotencyKey: string;
  headers?: Record<string, string>;
}

/** What a send produced: the HTTP status (0 = never reached the provider) and the provider's message id. */
export interface SendResult {
  status: number;
  providerMessageId: string | null;
  /** A short, secret-free error code for the outbox row — never the provider's raw body. */
  errorCode: string | null;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendResult>;
}

export interface EmailConfig {
  apiKey: string;
  /** `Voinic <notificari@voinic.fit>` — the verified sender, set as a secret, never in code. */
  from: string;
  /** `https://www.voinic.fit` — prefixed to every in-app path. */
  siteUrl: string;
  /** Sending is off unless this is exactly "true": a configured key alone sends nothing. */
  enabled: boolean;
}

export const EMAIL_CONFIG_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "SITE_URL"] as const;

export class EmailConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`email is not configured: ${missing.join(", ")}`);
    this.name = "EmailConfigError";
  }
}

const SENDER = /^[^<>\r\n]{1,80}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$|^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Reads and validates the configuration. Throws EmailConfigError naming the
 * missing or malformed keys; the message carries names only.
 */
export function readEmailConfig(get: (name: string) => string | undefined): EmailConfig {
  const problems: string[] = [];
  const apiKey = (get("RESEND_API_KEY") ?? "").trim();
  const from = (get("EMAIL_FROM") ?? "").trim();
  const siteRaw = (get("SITE_URL") ?? "").trim();

  if (!apiKey) problems.push("RESEND_API_KEY");
  if (!from || !SENDER.test(from)) problems.push("EMAIL_FROM");
  let siteUrl = "";
  try {
    const url = new URL(siteRaw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("not https");
    siteUrl = url.origin;
  } catch {
    problems.push("SITE_URL");
  }
  if (problems.length > 0) throw new EmailConfigError(problems);
  return { apiKey, from, siteUrl, enabled: get("EMAIL_DISPATCH_ENABLED") === "true" };
}

const RESEND_URL = "https://api.resend.com/emails";

/**
 * The Resend HTTP API. `fetchImpl` is injectable so tests use a mock — no test
 * ever reaches the network. A thrown fetch (DNS, TLS, timeout) is status 0.
 */
export function resendProvider(config: Pick<EmailConfig, "apiKey" | "from">, fetchImpl: typeof fetch = fetch): EmailProvider {
  return {
    name: "resend",
    async send(email) {
      let response: Response;
      try {
        response = await fetchImpl(RESEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": email.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
            ...(email.headers ? { headers: email.headers } : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return { status: 0, providerMessageId: null, errorCode: "network" };
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // a non-JSON answer still has a status
      }
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      if (response.ok) {
        return { status: response.status, providerMessageId: typeof record.id === "string" ? record.id : null, errorCode: null };
      }
      // Resend's `name` is a fixed code ("validation_error", "rate_limit_exceeded"…); keep only that.
      const code = typeof record.name === "string" && /^[a-z_]{1,60}$/.test(record.name) ? record.name : `http_${response.status}`;
      return { status: response.status, providerMessageId: null, errorCode: code };
    },
  };
}
