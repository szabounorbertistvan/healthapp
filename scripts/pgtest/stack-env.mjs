// The local E2E stack's fixed addresses and keys (stack.mjs serves them;
// e2e-local/target.ts reads them). No dependencies, so the Playwright config
// can import it without loading Postgres.
//
// The JWT secret is local-only and public, like the demo keys `supabase start`
// prints: it signs tokens for a throwaway database on 127.0.0.1 and nothing else.
import { createHmac } from "node:crypto";

export const STACK = {
  dbPort: 54430, gotruePort: 54431, restPort: 54432, gatewayPort: 54433,
  jwtSecret: "voinic-local-e2e-only-jwt-secret-not-used-anywhere-else",
};
export const SUPABASE_URL = `http://127.0.0.1:${STACK.gatewayPort}`;
// The app under test. Not 3100: that is the `web-prod` launch entry, which runs
// against the LIVE project, and the suite must never adopt it.
export const APP_URL = "http://localhost:3210";

const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
export function signJwt(claims, secret = STACK.jwtSecret) {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(claims);
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
// The two project keys, shaped like Supabase's (role + iss, ten years from a fixed iat).
const iat = 1_760_000_000;
export const ANON_KEY = signJwt({ iss: "supabase", role: "anon", iat, exp: iat + 315_360_000 });
export const SERVICE_KEY = signJwt({ iss: "supabase", role: "service_role", iat, exp: iat + 315_360_000 });
