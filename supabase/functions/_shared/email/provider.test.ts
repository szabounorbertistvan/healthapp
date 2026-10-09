import { describe, expect, it, vi } from "vitest";
import { EmailConfigError, readEmailConfig, resendProvider } from "./provider.ts";

const SECRET = "re_test_SECRET_value_never_shown";
const env = (values: Record<string, string>) => (name: string) => values[name];
const good = { RESEND_API_KEY: SECRET, EMAIL_FROM: "Voinic <notificari@voinic.fit>", SITE_URL: "https://www.voinic.fit/" };

describe("readEmailConfig", () => {
  it("names what is missing and never echoes a value", () => {
    try {
      readEmailConfig(env({ EMAIL_FROM: "not an address", SITE_URL: "http://voinic.fit" }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EmailConfigError);
      expect((e as EmailConfigError).missing).toEqual(["RESEND_API_KEY", "EMAIL_FROM", "SITE_URL"]);
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

describe("resendProvider (mocked fetch — no network)", () => {
  const email = { to: "ana@example.test", subject: "S", html: "<p>h</p>", text: "t", idempotencyKey: "voinic-notification-1" };

  it("sends one request with the key in the header only, and the idempotency key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    const result = await resendProvider({ apiKey: SECRET, from: good.EMAIL_FROM }, fetchMock as unknown as typeof fetch).send(email);
    expect(result).toEqual({ status: 200, providerMessageId: "msg_1", errorCode: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["Idempotency-Key"]).toBe("voinic-notification-1");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: good.EMAIL_FROM, to: ["ana@example.test"], subject: "S" });
    expect(init.body as string).not.toContain(SECRET);
  });

  it("turns a thrown fetch into status 0 and keeps only a fixed error code", async () => {
    const down = resendProvider({ apiKey: SECRET, from: good.EMAIL_FROM }, (async () => { throw new Error(`boom ${SECRET}`); }) as unknown as typeof fetch);
    expect(await down.send(email)).toEqual({ status: 0, providerMessageId: null, errorCode: "network" });

    const rejected = resendProvider({ apiKey: SECRET, from: good.EMAIL_FROM }, (async () =>
      new Response(JSON.stringify({ name: "validation_error", message: `bad ${SECRET} ana@example.test` }), { status: 422 })) as unknown as typeof fetch);
    const r = await rejected.send(email);
    expect(r).toEqual({ status: 422, providerMessageId: null, errorCode: "validation_error" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});
