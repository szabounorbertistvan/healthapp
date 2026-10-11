// The marketplace email dispatcher, minus I/O: the HTTP handler and the batch
// loop, with the outbox store and the provider passed in. The edge function
// (marketplace-email-dispatch/index.ts) wires the real ones; the tests wire
// mocks. Nothing here sends unless a provider is handed to it.
//
// What a caller can ask for: run a batch (`limit`), or look without sending
// (`dry_run`). What a caller can NOT do: name a recipient, an address, a
// subject or a body. Rows come only from the outbox, which only the database
// fills (one row per eligible notification — docs/MARKETPLACE_EMAIL.md).

import {
  classifyEmailSendStatus,
  emailRetryDelaySeconds,
  marketplaceEmailDecision,
  emailUnsubscribePath,
  marketplaceEmailIdempotencyKey,
} from "../../../../packages/shared/src/marketplace-email.ts";
import { EmailConfigError, readEmailConfig, type EmailConfig, type EmailProvider } from "./provider.ts";
import { renderMarketplaceEmail } from "./templates.ts";

/** One claimed outbox row, joined server-side with what the decision and the template need. */
export interface OutboxRow {
  id: string;
  notification_id: string;
  /** Send attempts already made (0 the first time). */
  attempts: number;
  category: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  email: string | null;
  email_confirmed: boolean;
  locale: string | null;
  time_zone: string | null;
  prefs: unknown;
  suspended: boolean;
  deletion_requested: boolean;
  actor_name: string | null;
  starts_at: string | null;
  /** The recipient — for the unsubscribe link only. */
  user_id: string;
  /** Signed in the database for this person and category (20261115100000); null = no switch for it. */
  unsubscribe_token: string | null;
}

export type OutboxUpdate =
  | { id: string; status: "sent"; lastStatus: number; providerMessageId: string | null }
  | { id: string; status: "skipped"; reason: string }
  | { id: string; status: "pending"; notBefore: string }
  | { id: string; status: "retry"; notBefore: string; lastStatus: number; errorCode: string | null }
  | { id: string; status: "failed"; lastStatus: number; errorCode: string | null };

export interface OutboxStore {
  /**
   * Whether the caller's key may use the outbox at all — the RPCs are granted
   * to service_role alone, so Postgres decides, not a string comparison.
   */
  authorize(): Promise<boolean>;
  /** Locks and returns due rows (FOR UPDATE SKIP LOCKED); a second caller never gets the same row. */
  claim(limit: number): Promise<OutboxRow[]>;
  /** Due rows without locking or changing them — for a dry run. */
  peek(limit: number): Promise<OutboxRow[]>;
  /** Records the outcome; only a row this run claimed can move. */
  mark(update: OutboxUpdate): Promise<void>;
}

export interface BatchSummary {
  claimed: number;
  sent: number;
  skipped: number;
  waiting: number;
  retry: number;
  failed: number;
  dryRun: boolean;
  /** Ids, categories and outcomes only — never an address, a name or a body. */
  log: { id: string; category: string; event: string; outcome: string; status?: number; reason?: string }[];
}

export const DEFAULT_BATCH = 20;
export const MAX_BATCH = 50;

const eventOf = (row: OutboxRow) => (typeof row.payload?.event === "string" ? row.payload.event : "*");

export async function processBatch(args: {
  store: OutboxStore;
  provider: EmailProvider | null;
  config: Pick<EmailConfig, "siteUrl">;
  now: () => Date;
  limit: number;
  dryRun: boolean;
}): Promise<BatchSummary> {
  const { store, provider, config, dryRun } = args;
  const rows = dryRun ? await store.peek(args.limit) : await store.claim(args.limit);
  const summary: BatchSummary = { claimed: rows.length, sent: 0, skipped: 0, waiting: 0, retry: 0, failed: 0, dryRun, log: [] };

  for (const row of rows) {
    const event = eventOf(row);
    const entry = { id: row.id, category: row.category, event };
    const decision = marketplaceEmailDecision(
      { category: row.category, payload: row.payload, createdAt: row.created_at, readAt: row.read_at },
      {
        hasEmail: Boolean(row.email),
        emailConfirmed: row.email_confirmed,
        suspended: row.suspended,
        deletionRequested: row.deletion_requested,
        prefs: row.prefs,
      },
      args.now(),
    );

    if (decision.action === "skip") {
      summary.skipped++;
      summary.log.push({ ...entry, outcome: "skipped", reason: decision.reason });
      if (!dryRun) await store.mark({ id: row.id, status: "skipped", reason: decision.reason });
      continue;
    }
    if (decision.action === "wait") {
      summary.waiting++;
      summary.log.push({ ...entry, outcome: "waiting" });
      if (!dryRun) await store.mark({ id: row.id, status: "pending", notBefore: decision.until });
      continue;
    }

    // Every email can switch itself off in one click; one that cannot is not sent.
    if (!row.unsubscribe_token) {
      summary.skipped++;
      summary.log.push({ ...entry, outcome: "skipped", reason: "no_unsubscribe" });
      if (!dryRun) await store.mark({ id: row.id, status: "skipped", reason: "no_unsubscribe" });
      continue;
    }
    const unsubscribeLink = `${config.siteUrl}${emailUnsubscribePath(row.user_id, row.category, row.unsubscribe_token)}`;
    const oneClickLink = `${config.siteUrl}${emailUnsubscribePath(row.user_id, row.category, row.unsubscribe_token, true)}`;

    const rendered = renderMarketplaceEmail({
      category: row.category,
      event,
      locale: row.locale,
      actorName: row.actor_name,
      startsAt: row.starts_at,
      timeZone: row.time_zone,
      link: `${config.siteUrl}${decision.path ?? "/notifications"}`,
      settingsLink: `${config.siteUrl}/account`,
      unsubscribeLink,
    });
    if (!rendered) {
      summary.skipped++;
      summary.log.push({ ...entry, outcome: "skipped", reason: "no_template" });
      if (!dryRun) await store.mark({ id: row.id, status: "skipped", reason: "no_template" });
      continue;
    }
    if (dryRun || !provider) {
      summary.log.push({ ...entry, outcome: "would_send" });
      continue;
    }

    const result = await provider.send({
      to: row.email!,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: marketplaceEmailIdempotencyKey(row.notification_id),
      // RFC 8058 one-click: Gmail / Yahoo show "Unsubscribe" and POST here.
      headers: { "List-Unsubscribe": `<${oneClickLink}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    const kind = classifyEmailSendStatus(result.status);
    if (kind === "sent") {
      summary.sent++;
      summary.log.push({ ...entry, outcome: "sent", status: result.status });
      await store.mark({ id: row.id, status: "sent", lastStatus: result.status, providerMessageId: result.providerMessageId });
      continue;
    }
    const delay = kind === "retry" ? emailRetryDelaySeconds(row.attempts + 1) : null;
    if (delay !== null) {
      summary.retry++;
      summary.log.push({ ...entry, outcome: "retry", status: result.status });
      await store.mark({
        id: row.id, status: "retry", lastStatus: result.status, errorCode: result.errorCode,
        notBefore: new Date(args.now().getTime() + delay * 1000).toISOString(),
      });
    } else {
      summary.failed++;
      summary.log.push({ ...entry, outcome: "failed", status: result.status });
      await store.mark({ id: row.id, status: "failed", lastStatus: result.status, errorCode: result.errorCode });
    }
  }
  return summary;
}

const ALLOWED_FIELDS = new Set(["limit", "dry_run"]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * The function's whole HTTP surface. Service role only — decided by Postgres,
 * as in rest-push: the caller's bearer becomes the database client's key, and
 * the outbox RPCs are executable by service_role alone, so any other key gets
 * 42501 → 403 before anything else is looked at. (Comparing the bearer to the
 * runtime's SUPABASE_SERVICE_ROLE_KEY fails on this project: the Vault key the
 * cron sends is a valid service-role key but not byte-equal to that variable.)
 * The body may carry `limit` and `dry_run` and nothing else — a recipient,
 * address, subject or html field is refused, not ignored.
 */
export async function handleDispatchRequest(
  req: Request,
  deps: {
    env: (name: string) => string | undefined;
    makeStore: (bearer: string) => OutboxStore;
    makeProvider: (config: EmailConfig) => EmailProvider;
    now?: () => Date;
  },
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return json({ error: "forbidden" }, 403);
  const store = deps.makeStore(bearer);
  try {
    if (!(await store.authorize())) return json({ error: "forbidden" }, 403);
  } catch (e) {
    console.error("marketplace-email-dispatch: authorize failed:", e instanceof Error ? e.message : "unknown error");
    return json({ error: "store_unavailable" }, 500);
  }

  let body: Record<string, unknown> = {};
  const raw = await req.text();
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_body" }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_body" }, 400);
    }
  }
  const unexpected = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unexpected.length > 0) return json({ error: "unexpected_field", fields: unexpected.sort() }, 400);

  const limitRaw = body.limit ?? DEFAULT_BATCH;
  if (typeof limitRaw !== "number" || !Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > MAX_BATCH) {
    return json({ error: "invalid_limit" }, 400);
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") return json({ error: "invalid_body" }, 400);
  const dryRun = body.dry_run === true;

  let config: EmailConfig;
  try {
    config = readEmailConfig(deps.env);
  } catch (e) {
    if (e instanceof EmailConfigError) return json({ error: "email_not_configured", missing: e.missing }, 503);
    return json({ error: "email_not_configured" }, 503);
  }
  if (!config.enabled && !dryRun) return json({ error: "email_dispatch_disabled" }, 503);

  try {
    const summary = await processBatch({
      store,
      provider: dryRun ? null : deps.makeProvider(config),
      config,
      now: deps.now ?? (() => new Date()),
      limit: limitRaw,
      dryRun,
    });
    return json(summary, 200);
  } catch (e) {
    // e.g. the outbox RPCs do not exist yet; the detail stays in the function log, not the response
    console.error("marketplace-email-dispatch: batch failed:", e instanceof Error ? e.message : "unknown error");
    return json({ error: "store_unavailable" }, 500);
  }
}
