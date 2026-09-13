import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The signed-in user's id, preferring the local JWT check.
 *
 * `auth.getUser()` is a round trip to the Auth server, and a page that reads a
 * dozen things used to make a dozen of them before it could start on the real
 * data. `getClaims()` verifies the access token's signature with WebCrypto
 * against the project's published ES256 key — fetched once per process and
 * cached — so the common case costs nothing on the wire.
 *
 * It is not a drop-in replacement, though: `getClaims()` only *returns* an
 * error for auth errors, and rethrows everything else. A hiccup fetching the
 * key set, or any environment where the verification cannot run, would escape
 * as an unhandled exception — and because it reaches for the key set only once
 * a session actually exists, that lands on the first page after signing in
 * rather than anywhere a test without a session would see it. `getUser()`
 * folded those same failures into its error return, so swapping one for the
 * other silently traded robustness for latency.
 *
 * So: fast path first, and on anything unexpected fall back to the call that
 * was always there. The id decides which rows we *ask* for; RLS decides which
 * ones we get, and that is unchanged either way.
 *
 * No `server-only` import here on purpose — the middleware runs in the Edge
 * runtime and needs this too.
 */
export async function userIdFromClient(
  supabase: SupabaseClient,
  onFallback?: (error: unknown) => void,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error) return data?.claims?.sub ?? null;
  } catch (error) {
    onFallback?.(error);
  }
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
