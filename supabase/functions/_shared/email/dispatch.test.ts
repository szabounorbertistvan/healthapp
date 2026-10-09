import { describe, expect, it, vi } from "vitest";
import { handleDispatchRequest, processBatch, type OutboxRow, type OutboxStore, type OutboxUpdate } from "./dispatch.ts";
import type { EmailProvider, OutgoingEmail, SendResult } from "./provider.ts";

const SERVICE = "service-role-key-for-tests";
const SECRET = "re_test_SECRET_value_never_shown";
const NOW = new Date("2026-10-09T12:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const CONFIGURED: Record<string, string> = { SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: SECRET, EMAIL_FROM: "Voinic <n@voinic.fit>", SITE_URL: "https://www.voinic.fit" };

function row(over: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "o1", notification_id: "11111111-2222-4333-8444-555555555555", attempts: 0,
    category: "booking", payload: { event: "confirmed", screen: "my_bookings" }, created_at: ago(1), read_at: null,
    email: "ana@example.test", email_confirmed: true, locale: "ro", time_zone: "Europe/Bucharest", prefs: {},
    suspended: false, deletion_requested: false, actor_name: "Kai", starts_at: "2026-10-12T07:00:00Z",
    ...over,
  };
}

function mockStore(rows: OutboxRow[]) {
  const marks: OutboxUpdate[] = [];
  const store: OutboxStore = {
    claim: vi.fn(async () => rows),
    peek: vi.fn(async () => rows),
    mark: vi.fn(async (u: OutboxUpdate) => { marks.push(u); }),
  };
  return { store, marks };
}

function mockProvider(results: SendResult[]) {
  const sent: OutgoingEmail[] = [];
  const provider: EmailProvider = {
    name: "mock",
    send: vi.fn(async (e: OutgoingEmail) => { sent.push(e); return results.shift() ?? { status: 200, providerMessageId: "m", errorCode: null }; }),
  };
  return { provider, sent };
}

const run = (store: OutboxStore, provider: EmailProvider | null, dryRun = false) =>
  processBatch({ store, provider, config: { siteUrl: "https://www.voinic.fit" }, now: () => NOW, limit: 20, dryRun });

describe("processBatch", () => {
  it("sends a due operational email once, keyed by its notification, with the in-app link", async () => {
    const { store, marks } = mockStore([row()]);
    const { provider, sent } = mockProvider([{ status: 200, providerMessageId: "msg_1", errorCode: null }]);
    const summary = await run(store, provider);
    expect(summary.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("ana@example.test");
    expect(sent[0]!.idempotencyKey).toBe("voinic-notification-11111111-2222-4333-8444-555555555555");
    expect(sent[0]!.html).toContain("https://www.voinic.fit/coaches/bookings");
    expect(marks).toEqual([{ id: "o1", status: "sent", lastStatus: 200, providerMessageId: "msg_1" }]);
  });

  it("skips without sending: unconfirmed address, suspended account, opted out, not eligible", async () => {
    const rows = [
      row({ id: "a", email_confirmed: false }),
      row({ id: "b", suspended: true }),
      row({ id: "c", prefs: { email: { booking: false } } }),
      row({ id: "d", category: "coaching", payload: { event: "paused" } }),
    ];
    const { store, marks } = mockStore(rows);
    const { provider, sent } = mockProvider([]);
    await run(store, provider);
    expect(sent).toHaveLength(0);
    expect(marks.map((m) => (m.status === "skipped" ? m.reason : m.status))).toEqual([
      "email_unconfirmed", "account_inactive", "opted_out", "not_eligible",
    ]);
  });

  it("retries a passing failure with backoff, then stops; a permanent one fails at once", async () => {
    const { store, marks } = mockStore([row({ id: "r" }), row({ id: "p" }), row({ id: "x", attempts: 4 })]);
    const { provider } = mockProvider([
      { status: 429, providerMessageId: null, errorCode: "rate_limit_exceeded" },
      { status: 422, providerMessageId: null, errorCode: "validation_error" },
      { status: 503, providerMessageId: null, errorCode: "http_503" },
    ]);
    const summary = await run(store, provider);
    expect(summary).toMatchObject({ retry: 1, failed: 2 });
    expect(marks[0]).toEqual({ id: "r", status: "retry", lastStatus: 429, errorCode: "rate_limit_exceeded", notBefore: new Date(NOW.getTime() + 60_000).toISOString() });
    expect(marks[1]).toMatchObject({ id: "p", status: "failed", lastStatus: 422 });
    expect(marks[2]).toMatchObject({ id: "x", status: "failed", lastStatus: 503 });
  });

  it("holds a message, and never puts its text or sender into the email", async () => {
    const payload = { conversation_id: "11111111-2222-4333-8444-555555555555", screen: "client_thread", text: "my private words" };
    const prefs = { email: { new_message: true } };
    const held = mockStore([row({ category: "new_message", payload, created_at: ago(5), prefs })]);
    await run(held.store, mockProvider([]).provider);
    expect(held.marks[0]).toMatchObject({ status: "pending" });

    const due = mockStore([row({ category: "new_message", payload, created_at: ago(20), prefs, actor_name: "Kai Secretname" })]);
    const { provider, sent } = mockProvider([]);
    await run(due.store, provider);
    expect(sent).toHaveLength(1);
    for (const part of [sent[0]!.subject, sent[0]!.html, sent[0]!.text]) {
      expect(part).not.toContain("my private words");
      expect(part).not.toContain("Secretname");
    }
  });

  it("a dry run decides without sending or changing anything", async () => {
    const { store, marks } = mockStore([row()]);
    const { provider, sent } = mockProvider([]);
    const summary = await run(store, provider, true);
    expect(store.claim).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(marks).toHaveLength(0);
    expect(summary.log[0]).toMatchObject({ outcome: "would_send" });
    expect(JSON.stringify(summary)).not.toContain("ana@example.test");
  });
});

describe("handleDispatchRequest", () => {
  const call = (init: RequestInit & { env?: Record<string, string> } = {}) => {
    const { store } = mockStore([row()]);
    const { provider, sent } = mockProvider([]);
    const makeProvider = vi.fn(() => provider);
    const response = handleDispatchRequest(
      new Request("https://fn.local/marketplace-email-dispatch", { method: "POST", ...init }),
      { env: (n) => (init.env ?? CONFIGURED)[n], makeStore: () => store, makeProvider, now: () => NOW },
    );
    return { response, sent, makeProvider, store };
  };
  const auth = { Authorization: `Bearer ${SERVICE}` };

  it("refuses anyone without the service role key", async () => {
    expect((await call().response).status).toBe(403);
    expect((await call({ headers: { Authorization: "Bearer anon-key" } }).response).status).toBe(403);
    expect((await call({ method: "GET", headers: auth }).response).status).toBe(405);
    expect((await call({ headers: auth, env: {} }).response).status).toBe(500);
  });

  it("refuses a caller-chosen recipient, subject or body", async () => {
    const res = await call({ headers: auth, body: JSON.stringify({ to: "x@evil.test", subject: "hi", html: "<b>" }) }).response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unexpected_field", fields: ["html", "subject", "to"] });
    expect((await call({ headers: auth, body: JSON.stringify({ limit: 500 }) }).response).status).toBe(400);
    expect((await call({ headers: auth, body: "not json" }).response).status).toBe(400);
  });

  it("sends nothing when the provider is not configured, and names only what is missing", async () => {
    const { response, makeProvider } = call({ headers: auth, env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE, EMAIL_FROM: "bad" } });
    const res = await response;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "email_not_configured", missing: ["RESEND_API_KEY", "EMAIL_FROM", "SITE_URL"] });
    expect(makeProvider).not.toHaveBeenCalled();
  });

  it("stays off until enabled, but allows a dry run", async () => {
    expect((await call({ headers: auth }).response).status).toBe(503);
    const dry = call({ headers: auth, body: JSON.stringify({ dry_run: true }) });
    const res = await dry.response;
    expect(res.status).toBe(200);
    expect(dry.makeProvider).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });

  it("runs a batch when enabled, and hides store failures behind a generic error", async () => {
    const enabled: Record<string, string> = { ...CONFIGURED, EMAIL_DISPATCH_ENABLED: "true" };
    const ok = call({ headers: auth, env: enabled });
    expect((await ok.response).status).toBe(200);
    expect(ok.sent).toHaveLength(1);

    const failing: OutboxStore = { claim: async () => { throw new Error(`relation missing ${SECRET}`); }, peek: async () => [], mark: async () => {} };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleDispatchRequest(
      new Request("https://fn.local/x", { method: "POST", headers: auth }),
      { env: (n) => enabled[n], makeStore: () => failing, makeProvider: () => mockProvider([]).provider },
    );
    spy.mockRestore();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "store_unavailable" }));
  });
});
