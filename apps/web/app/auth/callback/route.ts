import { NextResponse, type NextRequest } from "next/server";
import { isDemo, supabaseServer } from "@/lib/supabase/server";

/**
 * Where every emailed auth link lands: confirmation after sign-up, password
 * recovery. Turns the one-time token into a session cookie and continues to
 * `next`.
 *
 * Two link shapes are accepted, because the two Supabase projects differ:
 *  - `?token_hash=…&type=…` — what our own templates (supabase/templates/)
 *    produce. Verified here, server-side, so it works from any device.
 *  - `?code=…` — what Supabase's default templates produce (the hosted verify
 *    endpoint redirects here with a PKCE code). Needs the code verifier cookie
 *    the browser stored when it made the request, so it only works in the
 *    browser that started the flow.
 *
 * A Route Handler, not a Server Component, so the cookie writes in
 * lib/supabase/server.ts actually land.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const isOAuth = searchParams.get("flow") === "oauth";
  const failure = next.startsWith("/reset-password")
    ? "/reset-password?error=expired"
    : isOAuth ? "/login?error=oauth" : "/login?error=link";

  if (isDemo) return NextResponse.redirect(new URL(next, origin));
  // Supabase reports an expired/used link (or a cancelled OAuth consent) on the
  // redirect itself. Every provider-side failure reaches the user as the same
  // generic `error=oauth`, so the description — the only thing separating a bad
  // client secret from a refused consent from a provider that is switched off —
  // is logged here or it is lost.
  const providerError = searchParams.get("error");
  if (providerError) {
    console.error("auth callback rejected by provider", providerError, searchParams.get("error_description") ?? "");
    return NextResponse.redirect(new URL(failure, origin));
  }

  const supabase = await supabaseServer();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");

  if (tokenHash && (type === "signup" || type === "email" || type === "recovery" || type === "invite" || type === "email_change")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) console.error("auth callback verifyOtp failed", error.message);
    return NextResponse.redirect(new URL(error ? failure : next, origin));
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("auth callback code exchange failed", error.message);
      return NextResponse.redirect(new URL(failure, origin));
    }
    // Google sign-up: the coach/client choice could not ride along as user
    // metadata, so it comes back here. claim_signup_role only acts on a row
    // created in the last few minutes, so a sign-in link carrying a stale
    // ?role= does nothing to an existing account.
    const role = searchParams.get("role");
    if (role === "coach" || role === "client") {
      const { error: claimError } = await supabase.rpc("claim_signup_role", { p_role: role });
      if (claimError) console.error("claim_signup_role failed", claimError.message);
    }
    return NextResponse.redirect(new URL(next, origin));
  }
  // neither link shape: a malformed or truncated callback URL, not a rejected
  // credential — worth separating, because it looks identical to the user
  console.error("auth callback had neither token_hash nor code");
  return NextResponse.redirect(new URL(failure, origin));
}

// only same-site paths; never an absolute URL from the query string
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}
