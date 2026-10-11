// The email provider, isolated behind one small interface so it can be swapped.
//
// Brevo is the provider (docs/MARKETPLACE_EMAIL.md). Nothing here runs unless
// the dispatcher is configured: readEmailConfig() refuses to return a config
// with a missing value, and the only thing it ever reports is the *names* of
// what is missing — never a value. The API key is read from the function's
// environment (Supabase Secrets) and is never logged, returned or thrown.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key → the provider sends at most once, whatever the retries. A UUID (Brevo requires one). */
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

export const EMAIL_CONFIG_KEYS = ["BREVO_API_KEY", "EMAIL_FROM", "SITE_URL"] as const;

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
  const apiKey = (get("BREVO_API_KEY") ?? "").trim();
  const from = (get("EMAIL_FROM") ?? "").trim();
  const siteRaw = (get("SITE_URL") ?? "").trim();

  if (!apiKey) problems.push("BREVO_API_KEY");
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

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

/** `Voinic <notificari@voinic.fit>` → Brevo's `{ name, email }`; a bare address has no name. */
export function brevoSender(from: string): { name?: string; email: string } {
  const named = /^(.*?)\s*<([^<>]+)>$/.exec(from.trim());
  if (!named) return { email: from.trim() };
  const name = named[1]!.trim().replace(/^"(.*)"$/, "$1");
  return name ? { name, email: named[2]! } : { email: named[2]! };
}

/**
 * The Brevo transactional email API. `fetchImpl` is injectable so tests use a
 * mock — no test ever reaches the network. A thrown fetch (DNS, TLS, timeout)
 * is status 0.
 *
 * Idempotency: Brevo takes the key as `idempotencyKey` inside the body's
 * `headers` (a UUID, remembered for 30 minutes) and answers a repeat with the
 * error code `duplicate_parameter` without sending. The request has one
 * recipient and no other list, so that code can only mean "already accepted":
 * it is reported as 208, a 2xx, so the dispatcher marks the row sent and
 * `last_status` 208 shows it was a dedupe. A retry more than 30 minutes after
 * the first attempt is not covered by Brevo (docs/MARKETPLACE_EMAIL.md §5).
 */
export function brevoProvider(config: Pick<EmailConfig, "apiKey" | "from">, fetchImpl: typeof fetch = fetch): EmailProvider {
  return {
    name: "brevo",
    async send(email) {
      let response: Response;
      try {
        response = await fetchImpl(BREVO_URL, {
          method: "POST",
          headers: {
            "api-key": config.apiKey,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: brevoSender(config.from),
            to: [{ email: email.to }],
            subject: email.subject,
            htmlContent: email.html,
            textContent: email.text,
            headers: { ...email.headers, idempotencyKey: email.idempotencyKey },
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
        return { status: response.status, providerMessageId: typeof record.messageId === "string" ? record.messageId : null, errorCode: null };
      }
      if (record.code === "duplicate_parameter") return { status: 208, providerMessageId: null, errorCode: null };
      // Brevo's `code` is a fixed enum ("invalid_parameter", "unauthorized", "not_enough_credits"…); keep only that, never `message`.
      const code = typeof record.code === "string" && /^[a-z_]{1,60}$/.test(record.code) ? record.code : `http_${response.status}`;
      return { status: response.status, providerMessageId: null, errorCode: code };
    },
  };
}
