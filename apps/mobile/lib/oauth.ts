import { createClient } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { config } from "./config";
import { enabledProviders, parseOAuthCallback } from "./oauth-callback";
import { supabase } from "./supabase";

// Google and Apple, the way the web's LoginForm offers them: Supabase OAuth,
// here in the phone's own browser tab (Custom Tabs / ASWebAuthenticationSession,
// which Google accepts, unlike a WebView), PKCE back to the app's address.
//
// The PKCE verifier lives in a throwaway client kept in memory for this one
// round trip. The app's main client stays on its default flow, because the
// emails it asks for (sign-up confirmation, password reset) open on the web,
// which could never read a verifier stored on the phone. Once the code is
// exchanged, the session is handed to the main client, which stores it in
// SecureStore like an email sign-in.
//
// No role travels with it: an account made this way has no username yet, so the
// app's complete-profile step asks for username, sex, age, coach-or-client and
// consent, as the web's /complete-profile does.

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = "google" | "apple";
export type OAuthOutcome = "ok" | "cancelled" | "failed";

/** voinic://auth/callback in a build; exp://…/--/auth/callback in Expo Go. Both must be allowed in Supabase → Auth → URL configuration. */
export function oauthRedirectUrl(): string {
  return Linking.createURL("auth/callback");
}

/** Which of Google / Apple the Supabase project has switched on; none when it cannot be read. */
export async function availableProviders(): Promise<Set<OAuthProvider>> {
  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabaseAnonKey } });
    if (!res.ok) return new Set();
    const on = enabledProviders(await res.json());
    return new Set((["google", "apple"] as const).filter((p) => on.has(p)));
  } catch {
    return new Set();
  }
}

export async function signInWithProvider(provider: OAuthProvider): Promise<OAuthOutcome> {
  const redirectTo = oauthRedirectUrl();
  const pkce = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { flowType: "pkce", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "voinic-oauth" },
  });
  try {
    const { data, error } = await pkce.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data.url) return "failed";
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "cancel" || result.type === "dismiss") return "cancelled";
    if (result.type !== "success") return "failed";
    const callback = parseOAuthCallback(result.url);
    if (callback.kind === "error") return "failed";
    const exchanged = await pkce.auth.exchangeCodeForSession(callback.code);
    const session = exchanged.data.session;
    if (exchanged.error || !session) return "failed";
    // the auth listener (lib/auth.tsx) swaps the sign-in screen for the app
    const { error: setError } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    return setError ? "failed" : "ok";
  } catch {
    return "failed";
  }
}
