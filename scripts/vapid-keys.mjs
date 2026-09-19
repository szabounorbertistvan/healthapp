// One-time Web Push bootstrap: mints the VAPID key pair (RFC 8292) the
// rest-push edge function signs with. Run once per environment; the keys
// never change afterwards or every browser subscription stops matching.
//
//   node scripts/vapid-keys.mjs
//
// Prints two things:
//   · VAPID_KEYS_JSON — the pair as JWKs, for
//       supabase secrets set VAPID_KEYS_JSON='…' VAPID_SUBJECT='mailto:you@example.com'
//   · NEXT_PUBLIC_VAPID_PUBLIC_KEY — the raw public key (base64url), for the
//     web app's environment. The private key must never reach the browser.
import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const algo = { name: "ECDSA", namedCurve: "P-256" };
const pair = await subtle.generateKey(algo, true, ["sign", "verify"]);

const publicKey = await subtle.exportKey("jwk", pair.publicKey);
const privateKey = await subtle.exportKey("jwk", pair.privateKey);
const raw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
const applicationServerKey = Buffer.from(raw).toString("base64url");

console.log("VAPID_KEYS_JSON=" + JSON.stringify({ publicKey, privateKey }));
console.log("");
console.log("NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + applicationServerKey);
