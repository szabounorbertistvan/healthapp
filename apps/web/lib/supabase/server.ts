import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { userIdFromClient } from "./claims";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Same trim as the browser client — a stray BOM in the deployment's environment
// breaks header construction here too. See lib/supabase/client.ts.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

/**
 * Opt-in wire tracing: with `SUPABASE_TRACE=1` in .env.local every PostgREST,
 * RPC and Auth call a render makes is logged with its duration and path, so a
 * slow page reads as a list of round trips instead of a guess. Nothing here
 * runs without the variable — the client gets the platform fetch as before.
 */
const tracedFetch: typeof fetch | undefined = process.env.SUPABASE_TRACE
  ? async (input, init) => {
      const started = performance.now();
      try {
        return await fetch(input, init);
      } finally {
        const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const path = target.replace(url, "").split("?")[0];
        const ms = Math.round(performance.now() - started).toString().padStart(4);
        console.log(`[supabase] ${ms}ms ${init?.method ?? "GET"} ${path}`);
      }
    }
  : undefined;

/**
 * Fail loudly, but only once someone actually needs a client.
 *
 * Deliberately not a module-scope throw: CI runs `npm run build` without any
 * Supabase variables set, and Next evaluates this module while prerendering
 * the static routes (landing, privacy, terms) that never touch Supabase at
 * all. Throwing on import would break the build for pages that do not need a
 * backend. Throwing here means a missing variable surfaces on the first
 * request that needs data, naming the variable instead of failing somewhere
 * inside @supabase/ssr with an opaque URL error.
 */
function requireConfig() {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env.local (copy .env.example).",
    );
  }
  return { url, anonKey };
}

/**
 * One Supabase client per request.
 *
 * `cache()` is React's request-scoped memo: every caller inside a single render
 * (or a single server action) gets the same instance. That matters for more
 * than allocation — each client carries its own auth state, so N clients meant
 * N independent session reads, and an access token expiring mid-render meant N
 * concurrent refresh attempts racing to rotate the same refresh token. One
 * client refreshes once and everyone else sees the result.
 */
export const supabaseServer = cache(async () => {
  const config = requireConfig();
  const cookieStore = await cookies();
  return createServerClient(
    config.url,
    config.anonKey,
    {
      global: tracedFetch ? { fetch: tracedFetch } : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — middleware refreshes sessions
          }
        },
      },
    },
  );
});

/** The signed-in user's id, or null. Resolved once per request. */
export const currentUserId = cache(async (): Promise<string | null> => {
  const supabase = await supabaseServer();
  return userIdFromClient(supabase, (error) => {
    console.error("[auth] getClaims failed, falling back to getUser:", error);
  });
});

export type LiveUser = {
  supabase: Awaited<ReturnType<typeof supabaseServer>>;
  userId: string;
};

/**
 * The live Supabase client plus the signed-in id, or null.
 *
 * Replaces the four-line `supabaseServer` + `currentUserId` + early-return
 * that every read and write used to open with. A null here always means
 * "not signed in".
 */
export const liveUser = cache(async (): Promise<LiveUser | null> => {
  const supabase = await supabaseServer();
  const userId = await currentUserId();
  if (!userId) return null;
  return { supabase, userId };
});
