import { afterEach, describe, expect, it, vi } from "vitest";
import { settle, settleRead } from "./settle-action";

const UNREACHABLE = "Couldn't reach the server.";

describe("settle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes an action's own result through, success or refusal", async () => {
    expect(await settle(async () => ({ ok: true }), UNREACHABLE)).toEqual({ ok: true });
    const refused = { ok: false, errorCode: "NO_ROWS", message: "Nothing was saved." };
    expect(await settle(async () => refused, UNREACHABLE)).toBe(refused);
  });

  // The regression: a call that never got an answer rejected, nothing caught it
  // inside startTransition, and the error boundary replaced the whole editor.
  it("turns a call that never answered into a failed result the screen can show", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dropped = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await settle(dropped, UNREACHABLE)).toEqual({ ok: false, message: UNREACHABLE });
  });

  it("leaves Next's redirect and notFound alone", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/programs;307;" });
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(settle(() => Promise.reject(redirect), UNREACHABLE)).rejects.toBe(redirect);
    await expect(settle(() => Promise.reject(notFound), UNREACHABLE)).rejects.toBe(notFound);
  });
});

describe("settleRead", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes a read's answer through", async () => {
    expect(await settleRead(async () => [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("answers null when the call never got a reply, so the screen keeps what it shows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await settleRead(() => Promise.reject(new TypeError("Failed to fetch")))).toBeNull();
  });

  it("leaves Next's control flow alone", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/login;307;" });
    await expect(settleRead(() => Promise.reject(redirect))).rejects.toBe(redirect);
  });
});
