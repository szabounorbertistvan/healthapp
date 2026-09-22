"use server";
// Application error reporting.
//
// Until now the panel's "Application errors" tile was an honest dash: nothing
// in the app wrote an error anywhere the database could see. This is the one
// writer's entry point — `record_app_error()` (20260922100000), which is
// security definer, flood-capped per user and per address, and readable only
// by an admin.
//
// What crosses the wire is deliberately thin: the error's message (or, in a
// production build, only the Next.js digest, because React replaces a server
// error's message with one), the route it happened on, and a trimmed stack.
// Never a form value, a token, a request body, or anything the person typed.
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export type ErrorSource = "client" | "server" | "edge";

/**
 * Best effort by construction: a failure to report an error must never become
 * a second error on screen, so everything here is swallowed.
 */
export async function reportAppError(input: {
  source: ErrorSource;
  message: string;
  digest?: string | null;
  route?: string | null;
  stack?: string | null;
  level?: "error" | "warn";
}): Promise<void> {
  const message = input.message?.trim();
  if (!message) return;
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim().slice(0, 64) || null;
    const supabase = await supabaseServer();
    await supabase.rpc("record_app_error", {
      p_source: input.source,
      p_message: message.slice(0, 500),
      p_digest: input.digest?.slice(0, 64) ?? null,
      p_route: input.route?.slice(0, 300) ?? null,
      p_stack: input.stack?.slice(0, 4000) ?? null,
      p_user_agent: h.get("user-agent")?.slice(0, 512) ?? null,
      p_ip: ip,
      p_level: input.level ?? "error",
    });
  } catch {
    // no-op: see above
  }
}
