"use server";
import { redirect } from "next/navigation";
import { isDemo, supabaseServer } from "@/lib/supabase/server";

/**
 * End the session and return to the landing page.
 *
 * A server action, deliberately. @supabase/ssr keeps the session in cookies, and
 * the `setAll` in lib/supabase/server.ts swallows cookie writes when it runs
 * inside a Server Component, where they are not allowed. A server action may
 * write, so this is the only place the auth cookies actually get cleared — a
 * supabase.auth.signOut() in the browser would drop the client's copy and leave
 * the cookie the middleware reads still valid.
 *
 * Demo mode has no session, so the redirect is the whole behaviour and neither
 * shell has to hide the button.
 */
export async function signOut(): Promise<void> {
  if (!isDemo) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect("/");
}
