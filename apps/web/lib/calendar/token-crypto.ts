/**
 * OAuth tokens are encrypted before they reach the database
 * (calendar_credentials, 20261111130000) and decrypted only in the server
 * process that calls the provider. AES-256-GCM: a random 96-bit IV per
 * token, the 128-bit tag authenticates it, and the connection id is bound as
 * associated data — a ciphertext copied onto another connection's row does
 * not decrypt.
 *
 * Stored form: "v<keyVersion>.<base64(iv | tag | ciphertext)>". The key is
 * 32 bytes from the server environment (CALENDAR_TOKEN_KEY, base64), never in
 * the database, never sent to a browser; rotating it is a new version with
 * the old one kept for reading until every row is re-encrypted.
 *
 * Pure (Node's crypto, no environment access) so it is unit-tested; the
 * server reads the key in lib/calendar/keys.ts. Nothing here logs.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type TokenKey = { version: number; key: Buffer };

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

/** A base64 key from the environment → a key, or an error that never echoes the value. */
export function parseTokenKey(base64: string | undefined, version = 1): TokenKey {
  const key = Buffer.from((base64 ?? "").trim(), "base64");
  if (key.length !== 32) throw new TokenCryptoError("CALENDAR_TOKEN_KEY must be 32 bytes, base64-encoded");
  if (!Number.isInteger(version) || version < 1 || version > 32767) throw new TokenCryptoError("invalid key version");
  return { version, key };
}

export function encryptToken(plaintext: string, key: TokenKey, connectionId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(Buffer.from(connectionId, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v${key.version}.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

/** The key version a stored token was written with (to pick the key, or to find rows to re-encrypt). */
export function tokenKeyVersion(stored: string): number | null {
  const m = stored.match(/^v(\d{1,5})\./);
  return m ? Number(m[1]) : null;
}

export function decryptToken(stored: string, keys: TokenKey[], connectionId: string): string {
  const version = tokenKeyVersion(stored);
  const key = keys.find((k) => k.version === version);
  if (!key) throw new TokenCryptoError("no key for this token version");
  const raw = Buffer.from(stored.slice(stored.indexOf(".") + 1), "base64");
  if (raw.length < 12 + 16 + 1) throw new TokenCryptoError("malformed token");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(connectionId, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // never the token, the key or the provider's text in an error
    throw new TokenCryptoError("token could not be decrypted");
  }
}
