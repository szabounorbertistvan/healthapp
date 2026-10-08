import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { TokenCryptoError, decryptToken, encryptToken, parseTokenKey, tokenKeyVersion } from "./token-crypto";

const k1 = parseTokenKey(randomBytes(32).toString("base64"), 1);
const k2 = parseTokenKey(randomBytes(32).toString("base64"), 2);
const CONN = "0f0f0f0f-1111-4222-8333-444444444444";

describe("calendar token encryption", () => {
  it("round-trips, and never stores the plaintext", () => {
    const stored = encryptToken("ya29.secret-access-token", k1, CONN);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("secret");
    expect(decryptToken(stored, [k1], CONN)).toBe("ya29.secret-access-token");
  });
  it("a fresh IV every time: the same token encrypts differently", () => {
    expect(encryptToken("same", k1, CONN)).not.toBe(encryptToken("same", k1, CONN));
  });
  it("is bound to its connection: a ciphertext moved to another row does not decrypt", () => {
    const stored = encryptToken("token", k1, CONN);
    expect(() => decryptToken(stored, [k1], "another-connection")).toThrow(TokenCryptoError);
  });
  it("detects tampering", () => {
    const stored = encryptToken("token", k1, CONN);
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptToken(`v1.${raw.toString("base64")}`, [k1], CONN)).toThrow("token could not be decrypted");
  });
  it("rotation: the version picks the key; an unknown version is refused", () => {
    const old = encryptToken("token", k1, CONN);
    expect(tokenKeyVersion(old)).toBe(1);
    expect(decryptToken(old, [k2, k1], CONN)).toBe("token");
    expect(() => decryptToken(old, [k2], CONN)).toThrow("no key for this token version");
  });
  it("a wrong-size key is refused without echoing it", () => {
    expect(() => parseTokenKey("c2hvcnQ=")).toThrow(/32 bytes/);
    try { parseTokenKey("c2hvcnQ="); } catch (e) { expect(String(e)).not.toContain("c2hvcnQ="); }
    expect(() => parseTokenKey(undefined)).toThrow(TokenCryptoError);
  });
});
