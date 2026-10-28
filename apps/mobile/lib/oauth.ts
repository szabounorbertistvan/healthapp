import { createClient } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { config } from "./config";
import { appleName, appleRejection, enabledProviders, parseOAuthCallback } from "./oauth-callback";
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
// Apple on an iPhone skips the browser: the system's own Sign in with Apple sheet
// (expo-apple-authentication) hands back an identity token, which Supabase checks
// in signInWithIdToken — the bundle id fit.voinic.app must be among the Apple
// provider's Client IDs (docs/APPLE_SIGNIN_SETUP.md). Android has no such sheet
// and keeps the browser tab.
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
  if (provider === "apple" && Platform.OS === "ios" && (await AppleAuthentication.isAvailableAsync().catch(() => false))) {
    return signInWithAppleSheet();
  }
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

/**
 * The native sheet. A random nonce goes to Apple hashed and to Supabase raw, so a
 * token is good for this one sign-in only. Apple tells the name once, at the first
 * sign-in; it goes into the account's metadata for complete-profile to pre-fill.
 */
async function signInWithAppleSheet(): Promise<OAuthOutcome> {
  const nonce = Crypto.randomUUID();
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce),
    });
  } catch (e) {
    return appleRejection(e);
  }
  if (!credential.identityToken) return "failed";
  try {
    // the auth listener (lib/auth.tsx) swaps the sign-in screen for the app
    const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce });
    if (error) return "failed";
    const name = appleName(credential.fullName);
    if (name) await supabase.auth.updateUser({ data: { full_name: name } }).catch(() => {});
    return "ok";
  } catch {
    return "failed";
  }
}
