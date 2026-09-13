import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { userIdFromClient } from "./claims";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Same trim as the browser client — a stray BOM in the deployment's environment
// breaks header construction here too. See lib/supabase/client.ts.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export const isDemo = !url;

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
  const cookieStore = await cookies();
  return createServerClient(
    url,
    anonKey,
    {
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
  if (isDemo) return null;
  const supabase = await supabaseServer();
  return userIdFromClient(supabase, (error) => {
    console.error("[auth] getClaims failed, falling back to getUser:", error);
  });
});
