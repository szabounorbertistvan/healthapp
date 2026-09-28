import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MEDIA_TOKEN_WINDOW_SECONDS,
  mediaTokenExpiry,
  mediaTokenKey,
  signMediaToken,
  verifyMediaToken,
} from "./media-token";

const key = mediaTokenKey("test-secret");
const pid = "voinic/posts/e1000000-0000-0000-0000-00000000000a/m-00000000-0000-0000-0000-000000000001";
const now = 1_790_000_000;

describe("media tokens", () => {
  it("round-trips a picture and its size", () => {
    const token = signMediaToken(pid, "feed", now, key);
    expect(verifyMediaToken(token, now, key)).toEqual({ publicId: pid, variant: "feed", expiresAt: mediaTokenExpiry(now) });
  });

  it("lives at least one full window and at most two", () => {
    const exp = mediaTokenExpiry(now);
    expect(exp - now).toBeGreaterThan(MEDIA_TOKEN_WINDOW_SECONDS);
    expect(exp - now).toBeLessThanOrEqual(2 * MEDIA_TOKEN_WINDOW_SECONDS);
  });

  it("is the same link within a window, so the browser can cache it", () => {
    const start = Math.floor(now / MEDIA_TOKEN_WINDOW_SECONDS) * MEDIA_TOKEN_WINDOW_SECONDS;
    expect(signMediaToken(pid, "thumb", start, key)).toBe(signMediaToken(pid, "thumb", start + 299, key));
    expect(signMediaToken(pid, "thumb", start, key)).not.toBe(signMediaToken(pid, "thumb", start + 300, key));
  });

  it("dies when it expires", () => {
    const token = signMediaToken(pid, "feed", now, key);
    expect(verifyMediaToken(token, mediaTokenExpiry(now), key)).toBeNull();
    expect(verifyMediaToken(token, mediaTokenExpiry(now) - 1, key)).not.toBeNull();
  });

  it("refuses a token signed with another key", () => {
    const token = signMediaToken(pid, "feed", now, mediaTokenKey("someone-else"));
    expect(verifyMediaToken(token, now, key)).toBeNull();
  });

  it("refuses any change to what it names", () => {
    const token = signMediaToken(pid, "thumb", now, key);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: pid.replace("0001", "0002"), v: "thumb", e: mediaTokenExpiry(now) })).toString("base64url");
    expect(verifyMediaToken(`${forged}.${sig}`, now, key)).toBeNull();
    const bigger = Buffer.from(JSON.stringify({ p: pid, v: "feed", e: mediaTokenExpiry(now) })).toString("base64url");
    expect(verifyMediaToken(`${bigger}.${sig}`, now, key)).toBeNull();
    const longer = Buffer.from(JSON.stringify({ p: pid, v: "thumb", e: mediaTokenExpiry(now) + 86400 })).toString("base64url");
    expect(verifyMediaToken(`${longer}.${sig}`, now, key)).toBeNull();
    expect(verifyMediaToken(`${body}.${sig}x`, now, key)).toBeNull();
  });

  it("refuses garbage without throwing", () => {
    for (const bad of ["", ".", "abc", "a.b.c", "x".repeat(700), `${"e30"}.${"AA"}`]) {
      expect(verifyMediaToken(bad, now, key)).toBeNull();
    }
  });

  it("refuses a size that is not on the list", () => {
    const body = Buffer.from(JSON.stringify({ p: pid, v: "original", e: mediaTokenExpiry(now) })).toString("base64url");
    const sig = createHmac("sha256", key).update(body).digest("base64url");
    expect(verifyMediaToken(`${body}.${sig}`, now, key)).toBeNull();
  });
});
