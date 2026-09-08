"use client";
import { createBrowserClient } from "@supabase/ssr";

// Trimmed on the way in. These two are inlined into the browser bundle and then
// handed to fetch as the `apikey` and `Authorization` header values, where only
// ISO-8859-1 is legal. A value pasted into a dashboard with a leading BOM
// (U+FEFF) or a trailing newline makes every request fail with "String contains
// non ISO-8859-1 code point" — trim() removes both.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export const isDemo = !url;

export function supabaseBrowser() {
  return createBrowserClient(url, anonKey);
}

/**
 * Which OAuth providers this Supabase project has switched on. GoTrue's
 * /settings endpoint is public (anon key only) and is the same thing its own
 * dashboard reads. A disabled provider does not redirect back with an error —
 * /authorize answers with a bare JSON error page — so the login page asks
 * first and hides the button rather than sending anyone there.
 *
 * Demo mode reports every provider as enabled so the button is visible.
 */
export async function enabledOAuthProviders(): Promise<Set<string>> {
  if (isDemo) return new Set(["google", "apple"]);
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!res.ok) return new Set();
    const json = (await res.json()) as { external?: Record<string, boolean> };
    return new Set(
      Object.entries(json.external ?? {})
        .filter(([, enabled]) => enabled === true)
        .map(([provider]) => provider),
    );
  } catch {
    return new Set();
  }
}
