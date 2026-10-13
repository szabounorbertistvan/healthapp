// Where the local E2E suite (e2e-local/) may run — and nowhere else.
//
// That suite WRITES (programs, plans, coaching requests, a password reset),
// so every address it is handed must be this machine, and so must anything
// the environment says about which Supabase the app talks to. Pure: it reads
// only the `env` object it is given, so vitest covers every refusal
// (local-target.test.mjs) and e2e-local/target.ts calls it at config load,
// before Playwright starts a server or a test.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export class LocalTargetError extends Error {}

/** The URL itself if its host is this machine (http/https only); throws otherwise. */
export function loopbackUrl(raw, what) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new LocalTargetError(`e2e-local: ${what} is not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LocalTargetError(`e2e-local: ${what} must be http(s): ${raw}`);
  }
  // URL() already lower-cases the host and drops userinfo, so "http://127.0.0.1@evil.example"
  // is evil.example; a trailing dot ("localhost.") is a different name and is refused.
  if (!LOOPBACK.has(url.hostname)) {
    throw new LocalTargetError(`e2e-local: refusing to run against ${what} ${raw} — this suite writes, and only a local stack may take it.`);
  }
  return raw.replace(/\/+$/, "");
}

/** A Supabase API key issued for a hosted project carries its project `ref`; a local stack's does not. */
export function assertLocalKey(key, what) {
  const parts = String(key).split(".");
  if (parts.length !== 3) return; // not a JWT (e.g. a CLI sb_* key): the URL check is what guards it
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return;
  }
  if (claims && typeof claims === "object" && "ref" in claims) {
    throw new LocalTargetError(`e2e-local: ${what} was issued for the hosted project "${claims.ref}" — refusing to use it.`);
  }
}

/**
 * The suite's target, from `env` and the stack's own defaults.
 *  - nothing set: the Docker-less stack (`defaults`), which the config starts itself;
 *  - E2E_SUPABASE_URL (+ _ANON_KEY, _SERVICE_KEY, and E2E_LOCAL_BASE_URL for the app):
 *    a stack already running, e.g. `supabase start` in CI ("external").
 * Variables that would point the APP at another Supabase (NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_URL) must be local too, or unset: an external app reads them.
 */
export function resolveLocalTarget(env, defaults) {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    if (env[name]) loopbackUrl(env[name], name);
  }
  const external = Boolean(env.E2E_SUPABASE_URL);
  const supabaseUrl = loopbackUrl(env.E2E_SUPABASE_URL ?? defaults.supabaseUrl, "Supabase URL");
  const anonKey = env.E2E_SUPABASE_ANON_KEY ?? (external ? "" : defaults.anonKey);
  const serviceKey = env.E2E_SUPABASE_SERVICE_KEY ?? (external ? "" : defaults.serviceKey);
  if (!anonKey || !serviceKey) {
    throw new LocalTargetError("e2e-local: E2E_SUPABASE_URL needs E2E_SUPABASE_ANON_KEY and E2E_SUPABASE_SERVICE_KEY");
  }
  assertLocalKey(anonKey, "E2E_SUPABASE_ANON_KEY");
  assertLocalKey(serviceKey, "E2E_SUPABASE_SERVICE_KEY");
  if (external && !env.E2E_LOCAL_BASE_URL) {
    throw new LocalTargetError("e2e-local: with E2E_SUPABASE_URL, also set E2E_LOCAL_BASE_URL to the app started against it");
  }
  const appUrl = loopbackUrl(env.E2E_LOCAL_BASE_URL ?? defaults.appUrl, "app URL");
  return { supabaseUrl, anonKey, serviceKey, appUrl, external };
}

/** True for a request URL the browser may reach during the suite (this machine, or a data:/blob: URL). */
export function isLocalRequest(raw) {
  if (/^(data|blob|about):/.test(raw)) return true;
  try {
    return LOOPBACK.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}
