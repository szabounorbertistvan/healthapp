import { describe, expect, it } from "vitest";
import { authErrorKey, authErrorMessage, resendOutcome, RESEND_COOLDOWN_SECONDS } from "./auth-errors";

const err = (message: string, code?: string, extra: { name?: string; status?: number } = {}) => ({ message, code, ...extra });

describe("authErrorKey", () => {
  it("recognises an unconfirmed email, by code and by message", () => {
    expect(authErrorKey(err("Email not confirmed", "email_not_confirmed"))).toBe("errEmailNotConfirmed");
    expect(authErrorKey(err("Email not confirmed"))).toBe("errEmailNotConfirmed");
  });
});

describe("resendOutcome", () => {
  it("reports a send", () => {
    expect(resendOutcome(null)).toEqual({ kind: "sent" });
  });

  it("passes the rate limits through, with the wait when GoTrue quotes one", () => {
    const quoted = err("For security purposes, you can only request this after 42 seconds.", "over_email_send_rate_limit", { status: 429 });
    expect(resendOutcome(quoted)).toEqual({ kind: "error", key: "errEmailRateLimitedIn" });
    expect(authErrorMessage(quoted, { errEmailRateLimitedIn: "wait {seconds}s" } as never)).toBe("wait 42s");
    expect(resendOutcome(err("Email rate limit exceeded", "over_email_send_rate_limit", { status: 429 })))
      .toEqual({ kind: "error", key: "errEmailRateLimited" });
    expect(resendOutcome(err("Request rate limit reached", "over_request_rate_limit", { status: 429 })))
      .toEqual({ kind: "error", key: "errRateLimited" });
  });

  it("reports a request that never reached the server", () => {
    expect(resendOutcome(err("Failed to fetch", undefined, { name: "AuthRetryableFetchError", status: 0 })))
      .toEqual({ kind: "error", key: "errGeneric" });
    expect(resendOutcome(err("NetworkError when attempting to fetch resource.")))
      .toEqual({ kind: "error", key: "errGeneric" });
  });

  it("answers anything about the address itself with the same neutral 'sent'", () => {
    for (const e of [
      err("User not found", "user_not_found", { status: 404 }),
      err("Email address is invalid", "email_address_invalid", { status: 400 }),
      err("Email link is invalid or has expired", "otp_expired", { status: 403 }),
      err("Something unexpected", undefined, { status: 500 }),
    ]) {
      expect(resendOutcome(e)).toEqual({ kind: "sent" });
    }
  });

  it("keeps the button off long enough that a resend cannot loop", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBeGreaterThanOrEqual(60);
  });
});
