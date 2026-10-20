import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client, for the few server jobs that must act with no
 * signed-in user: the calendar sync worker and the OAuth callback that stores
 * a coach's encrypted tokens (calendar_credentials has no grant for anyone
 * else, by design — 20261111130000). Never imported by a component, never
 * used to read data on someone's behalf: user reads go through
 * supabaseServer() and RLS.
 *
 * Null when SUPABASE_SERVICE_ROLE_KEY is not set: callers then behave as
 * "not configured" instead of failing.
 */
export function supabaseService(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
