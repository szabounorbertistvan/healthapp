// What the provider's round trip handed back on the app's own address
// (voinic://auth/callback?code=… — or ?error=… when the person said no or
// Supabase refused). Pure, so it is tested in node; lib/oauth.ts does the rest.

export type OAuthCallback = { kind: "code"; code: string } | { kind: "error"; error: string };

/** Reads the code (PKCE) or the error from the callback URL — query first, then the fragment. */
export function parseOAuthCallback(url: string): OAuthCallback {
  const hash = url.indexOf("#");
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const query = beforeHash.includes("?") ? beforeHash.slice(beforeHash.indexOf("?") + 1) : "";
  const fragment = hash === -1 ? "" : url.slice(hash + 1);
  for (const part of [query, fragment]) {
    const params = new URLSearchParams(part);
    const error = params.get("error_description") || params.get("error");
    if (error) return { kind: "error", error };
    const code = params.get("code");
    if (code) return { kind: "code", code };
  }
  return { kind: "error", error: "no code in the callback" };
}

/** The providers switched on in the Supabase project, from its public /auth/v1/settings (the web's enabledOAuthProviders). */
export function enabledProviders(settings: unknown): Set<string> {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external ?? {};
  return new Set(Object.entries(external).filter(([, on]) => on === true).map(([name]) => name));
}
