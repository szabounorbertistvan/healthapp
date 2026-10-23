// No "server-only" marker: lib/i18n/server.ts imports this, and the component
// tests load that module under jsdom. node:async_hooks keeps it out of any
// browser bundle regardless, and it holds no secret — only the request's token.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locale } from "@/lib/i18n";

/**
 * The Android app's way into the same reads and writes the web uses.
 *
 * The web signs in with cookies; the app holds a Supabase access token and sends
 * it as `Authorization: Bearer …` to /api/v1/* (lib/api/v1.ts). Those handlers
 * run their work inside `withBearer`, and while they do `supabaseServer()`,
 * `currentUserId()` and `getLocale()` answer from the token and the app's
 * language instead of from cookies — so `getToday()` and every other lib/
 * read work for the app unchanged, under the same RLS, as the token's owner.
 *
 * AsyncLocalStorage, not a module variable: concurrent requests each see their
 * own token, and nothing outside a /api/v1 handler ever sees one.
 */
type BearerContext = { token: string; locale: Locale };

const store = new AsyncLocalStorage<BearerContext>();

export function withBearer<T>(context: BearerContext, work: () => Promise<T>): Promise<T> {
  return store.run(context, work);
}

/** The current /api/v1 request's token and language, or null everywhere else. */
export function bearerContext(): BearerContext | null {
  return store.getStore() ?? null;
}
