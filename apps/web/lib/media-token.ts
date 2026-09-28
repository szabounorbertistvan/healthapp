// The capability behind /api/media/<token>: which picture, which size, until when.
//
// Post pictures are Cloudinary `authenticated` assets, reachable only through
// a URL signed with the account secret — and those signatures never expire.
// Handing one to a browser would make it a permanent key to the picture, the
// exact thing a private asset is for avoiding. So the browser gets a link to
// this app instead, minted per render, only for a row the reader's own RPC
// returned (can_see_post and every rule behind it), valid for 5–10 minutes.
// The route checks the token, fetches the picture server-side and streams it.
//
// Pure (node:crypto only, no env, no server-only import) so it is testable;
// lib/cloudinary.ts supplies the key.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The sizes a post picture is delivered at — a fixed list, never a free width. */
export const MEDIA_VARIANTS = {
  /** The card and the post's own page. */
  feed: 1080,
  /** A notification thumbnail, a grid tile. */
  thumb: 320,
} as const;
export type MediaVariant = keyof typeof MEDIA_VARIANTS;

/**
 * Links expire on a 5-minute grid, each valid for at least one full window
 * after it is minted. The grid keeps the URL identical across renders within
 * a window, so the browser's cache serves repeats instead of downloading the
 * same picture again.
 */
export const MEDIA_TOKEN_WINDOW_SECONDS = 300;

export function mediaTokenExpiry(nowSeconds: number): number {
  return (Math.floor(nowSeconds / MEDIA_TOKEN_WINDOW_SECONDS) + 2) * MEDIA_TOKEN_WINDOW_SECONDS;
}

/** The HMAC key, derived from a server secret so the secret itself is never an HMAC key elsewhere. */
export function mediaTokenKey(secret: string): Buffer {
  return createHash("sha256").update(`voinic-media-token-v1:${secret}`).digest();
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function mac(key: Buffer, body: string): Buffer {
  return createHmac("sha256", key).update(body).digest();
}

export function signMediaToken(publicId: string, variant: MediaVariant, nowSeconds: number, key: Buffer): string {
  const body = b64url(JSON.stringify({ p: publicId, v: variant, e: mediaTokenExpiry(nowSeconds) }));
  return `${body}.${b64url(mac(key, body))}`;
}

export type MediaClaim = { publicId: string; variant: MediaVariant; expiresAt: number };

/** The claim, if the token is ours, untampered and unexpired; null otherwise. */
export function verifyMediaToken(token: string, nowSeconds: number, key: Buffer): MediaClaim | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  const expected = mac(key, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claim: { p?: unknown; v?: unknown; e?: unknown };
  try {
    claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claim.p !== "string" || typeof claim.e !== "number") return null;
  if (typeof claim.v !== "string" || !(claim.v in MEDIA_VARIANTS)) return null;
  if (claim.e <= nowSeconds) return null;
  return { publicId: claim.p, variant: claim.v as MediaVariant, expiresAt: claim.e };
}
