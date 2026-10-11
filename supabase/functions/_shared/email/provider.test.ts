import { describe, expect, it, vi } from "vitest";
import { brevoProvider, brevoSender, EmailConfigError, readEmailConfig } from "./provider.ts";

const SECRET = "xkeysib-test-SECRET-value-never-shown";
const env = (values: Record<string, string>) => (name: string) => values[name];
const good = { BREVO_API_KEY: SECRET, EMAIL_FROM: "Voinic <notificari@voinic.fit>", SITE_URL: "https://www.voinic.fit/" };

describe("readEmailConfig", () => {
  it("names what is missing and never echoes a value", () => {
    try {
      readEmailConfig(env({ EMAIL_FROM: "not an address", SITE_URL: "http://voinic.fit" }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EmailConfigError);
      expect((e as EmailConfigError).missing).toEqual(["BREVO_API_KEY", "EMAIL_FROM", "SITE_URL"]);
      expect((e as Error).message).not.toContain("not an address");
    }
  });

  it("accepts a complete configuration, normalises the site URL, and stays off unless enabled", () => {
    const config = readEmailConfig(env(good));
    expect(config.siteUrl).toBe("https://www.voinic.fit");
    expect(config.enabled).toBe(false);
    expect(readEmailConfig(env({ ...good, EMAIL_DISPATCH_ENABLED: "true" })).enabled).toBe(true);
    expect(readEmailConfig(env({ ...good, EMAIL_DISPATCH_ENABLED: "yes" })).enabled).toBe(false);
  });

  it("refuses a sender with a header break in it", () => {
    expect(() => readEmailConfig(env({ ...good, EMAIL_FROM: "Voinic\r\nBcc: x@y.z <a@voinic.fit>" }))).toThrow(EmailConfigError);
  });
});

describe("brevoSender", () => {
  it("splits a named sender and keeps a bare address bare", () => {
    expect(brevoSender("Voinic <notificari@voinic.fit>")).toEqual({ name: "Voinic", email: "notificari@voinic.fit" });
    expect(brevoSender('"Voinic Coach" <n@voinic.fit>')).toEqual({ name: "Voinic Coach", email: "n@voinic.fit" });
    expect(brevoSender("n@voinic.fit")).toEqual({ email: "n@voinic.fit" });
  });
});

describe("brevoProvider (mocked fetch — no network)", () => {
  const KEY = "11111111-2222-4333-8444-555555555555";
  const email = { to: "ana@example.test", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: KEY };
  const provider = (impl: () => Promise<Response>) =>
    brevoProvider({ apiKey: SECRET, from: good.EMAIL_FROM }, impl as unknown as typeof fetch);

  it("sends one request with the key in the header only, and the idempotency key in the body headers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "<msg_1@smtp-relay.mailin.fr>" }), { status: 201 }));
    const result = await brevoProvider({ apiKey: SECRET, from: good.EMAIL_FROM }, fetchMock as unknown as typeof fetch)
      .send({ ...email, headers: { "List-Unsubscribe": "<https://www.voinic.fit/u>" } });
    expect(result).toEqual({ status: 201, providerMessageId: "<msg_1@smtp-relay.mailin.fr>", errorCode: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe(SECRET);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      sender: { name: "Voinic", email: "notificari@voinic.fit" },
      to: [{ email: "ana@example.test" }],
      subject: "S",
      htmlContent: "<p>h</p>",
      textContent: "t",
      headers: { "List-Unsubscribe": "<https://www.voinic.fit/u>", idempotencyKey: KEY },
    });
    expect(init.body as string).not.toContain(SECRET);
  });

  it("treats a repeated idempotency key as already sent", async () => {
    const r = await provider(async () =>
      new Response(JSON.stringify({ code: "duplicate_parameter", message: "Request already processed" }), { status: 400 })).send(email);
    expect(r).toEqual({ status: 208, providerMessageId: null, errorCode: null });
  });

  it("turns a thrown fetch into status 0 and keeps only a fixed error code", async () => {
    const down = provider(async () => { throw new Error(`boom ${SECRET}`); });
    expect(await down.send(email)).toEqual({ status: 0, providerMessageId: null, errorCode: "network" });

    const rejected = provider(async () =>
      new Response(JSON.stringify({ code: "invalid_parameter", message: `bad ${SECRET} ana@example.test` }), { status: 400 }));
    const r = await rejected.send(email);
    expect(r).toEqual({ status: 400, providerMessageId: null, errorCode: "invalid_parameter" });
    expect(JSON.stringify(r)).not.toContain(SECRET);

    const odd = provider(async () => new Response(JSON.stringify({ code: "Insufficient credits" }), { status: 402 }));
    expect((await odd.send(email)).errorCode).toBe("http_402");
  });
});
