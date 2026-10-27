import { CONSENT_VERSION } from "@healthapp/shared/account/legal";
import { authErrorMessage, resendOutcome } from "@healthapp/shared/account/auth-errors";
import { birthYearFromAge, isValidAge, isValidUsername, SEXES } from "@healthapp/shared/account/profile";
import { useEffect, useState, type ComponentProps } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { Button, Card, Logo, NavIcon, T } from "@/components/ui";
import { signInWithPassword, type SignInError } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { openLegal } from "@/lib/legal";
import { availableProviders, signInWithProvider, type OAuthProvider } from "@/lib/oauth";
import { supabase } from "@/lib/supabase";
import { font, useTheme } from "@/lib/theme";

const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6";
const EYE_OFF = "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6";
const CHECK = "M5 12.5l4.5 4.5L19 7.5";
const MIN_PASSWORD = 8;

type Mode = "signin" | "signup" | "forgot";
type Role = "coach" | "client";
type Sex = (typeof SEXES)[number];
type Done = { kind: "confirm" | "reset"; email: string } | null;

// The web's /login on the phone (components/login-form.tsx): sign in, create
// an account, or ask for a reset link — the same fields, checks and user
// metadata as the web, so handle_new_user makes the same account; or Google /
// Apple, when the project has them on (lib/oauth.ts). Every link
// an email carries opens on the web (/auth/callback), which confirms the
// address or sets the new password; then the person signs in here.
export default function SignIn() {
  const { t, locale, setLocale } = useI18n();
  const { color } = useTheme();
  const l = t.login;
  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const [age, setAge] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [consent, setConsent] = useState({ terms: false, health: false });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState<string | null>(null);
  const [done, setDone] = useState<Done>(null);
  // each shown only once the Supabase project has the provider switched on (LoginForm)
  const [providers, setProviders] = useState<Set<OAuthProvider>>(new Set());

  useEffect(() => {
    let live = true;
    void availableProviders().then((p) => { if (live) setProviders(p); });
    return () => { live = false; };
  }, []);

  /** Google / Apple cover sign-in and sign-up alike; a new account then finishes in complete-profile. */
  async function oauth(provider: OAuthProvider) {
    setBusy(true);
    setError(null);
    setUnconfirmed(false);
    try {
      const outcome = await signInWithProvider(provider);
      if (outcome === "failed") setError(l.errOAuth);
    } finally {
      setBusy(false);
    }
  }

  const signInMessages: Record<SignInError, string> = {
    missing: t.mobile.signIn.errMissing,
    invalid: t.mobile.signIn.errInvalid,
    unconfirmed: t.mobile.signIn.errUnconfirmed,
    network: t.mobile.signIn.errNetwork,
  };

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setDone(null);
    setUnconfirmed(false);
    setResent(null);
    setPassword("");
    setRepeat("");
  }

  // client-side checks, before anything is sent (LoginForm validate)
  function validate(): string | null {
    if (mode === "forgot") return email.trim() ? null : l.errEmailRequired;
    if (mode !== "signup") return null;
    if (fullName.trim().length === 0) return l.errNameRequired;
    if (!isValidUsername(username)) return l.errUsernameFormat;
    if (!sex) return l.errSexRequired;
    if (!isValidAge(parseInt(age, 10))) return l.errAgeRange;
    if (!email.trim()) return l.errEmailRequired;
    if (password.length < MIN_PASSWORD) return l.errPasswordShort;
    if (password !== repeat) return l.errPasswordMismatch;
    if (!consent.terms || !consent.health) return l.errConsent;
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    setUnconfirmed(false);
    setResent(null);
    try {
      if (mode === "signin") {
        // On success the auth listener swaps this screen for the tabs (app/_layout.tsx).
        const failure = await signInWithPassword(email, password);
        if (failure) {
          setError(signInMessages[failure]);
          setUnconfirmed(failure === "unconfirmed");
        }
        return;
      }
      if (mode === "signup") {
        // asked up front so a taken name is a friendly message, not a numbered variant chosen by the trigger
        const available = await supabase.rpc("username_available", { p_username: username.trim() });
        if (!available.error && available.data === false) return setError(l.errUsernameTaken);
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // read by the handle_new_user trigger, exactly as the web sends it
            data: {
              full_name: fullName.trim(),
              role,
              username: username.trim(),
              sex,
              birth_year: String(birthYearFromAge(parseInt(age, 10))),
              consent_version: CONSENT_VERSION,
            },
            emailRedirectTo: `${config.webUrl}/auth/callback?${new URLSearchParams({ next: role === "coach" ? "/dashboard" : "/today" })}`,
          },
        });
        if (e) return setError(authErrorMessage(e, l));
        // with confirmations on, "already registered" hides behind a user with no identities
        if (data.user && data.user.identities?.length === 0) return setError(l.errEmailTaken);
        // a session means confirmations are off: the auth listener takes it from here
        if (!data.session) setDone({ kind: "confirm", email: email.trim() });
        return;
      }
      const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${config.webUrl}/auth/callback?next=/reset-password`,
      });
      if (e) setError(authErrorMessage(e, l));
      else setDone({ kind: "reset", email: email.trim() });
    } catch {
      setError(t.mobile.signIn.errNetwork);
    } finally {
      setBusy(false);
    }
  }

  /** "Resend the confirmation email": a neutral answer unless rate-limited or unreachable (resendOutcome). */
  async function resend() {
    setResent(null);
    const { error: e } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${config.webUrl}/auth/callback?next=/today` },
    });
    const outcome = resendOutcome(e);
    setResent(outcome.kind === "sent" ? l.resendConfirmationSent : authErrorMessage(e, l));
  }

  const input = ({ style, label, ...rest }: ComponentProps<typeof TextInput> & { label: string }) => (
    <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={color.inkFaint} {...rest} style={[styles.field, { color: color.ink, backgroundColor: color.bg }, style]} />
  );
  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6}>
      <T kind="soft" style={{ fontSize: 14 }}>{label}</T>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.lang}>
        <View style={[styles.segment, { borderColor: color.line, backgroundColor: color.surface }]}>
          {(["en", "ro"] as const).map((code) => (
            <Pressable
              key={code}
              accessibilityRole="button"
              accessibilityState={{ selected: locale === code }}
              onPress={() => setLocale(code)}
              style={[styles.segmentItem, { backgroundColor: locale === code ? color.accent : "transparent" }]}
            >
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: locale === code ? color.accentFg : color.inkSoft }}>{code.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: 28 }}>
            <Logo height={22} />
          </View>
          {done ? (
            <Card style={{ padding: 20, gap: 12 }}>
              <Text accessibilityRole="header" style={{ fontFamily: font.bold, fontSize: 16, color: color.ink }}>
                {done.kind === "confirm" ? l.checkInboxTitle : l.resetSentTitle}
              </Text>
              <T kind="soft" style={{ fontSize: 14 }}>{(done.kind === "confirm" ? l.checkInboxBody : l.resetSentBody).replace("{email}", done.email)}</T>
              <Button kind="quiet" label={l.backToSignIn} onPress={() => switchMode("signin")} />
            </Card>
          ) : (
            <Card style={{ padding: 20, gap: 12 }}>
              {mode === "signup" ? (
                <>
                  <Text style={[styles.label, { color: color.inkSoft }]}>{l.iAm}</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(["client", "coach"] as const).map((r) => {
                      const on = role === r;
                      return (
                        <Pressable
                          key={r}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          onPress={() => setRole(r)}
                          style={[styles.role, { borderColor: on ? color.accent : color.line, backgroundColor: on ? color.accentSoft : color.bg }]}
                        >
                          <Text style={{ fontFamily: font.bold, fontSize: 14, color: on ? color.accentInk : color.ink }}>{r === "coach" ? l.roleCoach : l.roleClient}</Text>
                          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: color.inkSoft }}>{r === "coach" ? l.roleCoachBody : l.roleClientBody}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {input({ label: l.fullName, value: fullName, onChangeText: setFullName, autoComplete: "name", textContentType: "name" })}
                  <View>
                    {input({ label: l.username, value: username, onChangeText: setUsername, autoCapitalize: "none", autoCorrect: false, autoComplete: "username" })}
                    <Text style={[styles.hint, { color: color.inkFaint }]}>{l.usernameHint}</Text>
                  </View>
                  <View>
                    <Text style={[styles.label, { color: color.inkSoft }]}>{l.sex}</Text>
                    <View style={{ marginTop: 6, flexDirection: "row", gap: 6 }}>
                      {SEXES.map((s) => (
                        <Pressable
                          key={s}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: sex === s }}
                          onPress={() => setSex(s)}
                          style={[styles.pill, { backgroundColor: sex === s ? color.accent : color.bg }]}
                        >
                          <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: sex === s ? color.accentFg : color.inkSoft }}>
                            {s === "male" ? l.sexMale : s === "female" ? l.sexFemale : l.sexOther}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  {input({ label: l.age, value: age, onChangeText: (v) => setAge(v.replace(/\D/g, "").slice(0, 3)), keyboardType: "number-pad" })}
                </>
              ) : null}
              {input({ label: l.email, value: email, onChangeText: setEmail, autoCapitalize: "none", autoComplete: "email", keyboardType: "email-address", textContentType: "emailAddress" })}
              {mode !== "forgot" ? (
                <View>
                  {input({
                    label: l.password,
                    value: password,
                    onChangeText: setPassword,
                    autoComplete: mode === "signup" ? "new-password" : "current-password",
                    secureTextEntry: !show,
                    textContentType: mode === "signup" ? "newPassword" : "password",
                    onSubmitEditing: mode === "signin" ? () => void submit() : undefined,
                    returnKeyType: mode === "signin" ? "go" : "next",
                    style: { paddingRight: 48 },
                  })}
                  <Pressable accessibilityRole="button" accessibilityLabel={show ? l.hidePassword : l.showPassword} onPress={() => setShow((v) => !v)} style={styles.eye}>
                    <NavIcon d={show ? EYE_OFF : EYE} size={20} color={color.inkFaint} />
                  </Pressable>
                  {mode === "signup" ? <Text style={[styles.hint, { color: color.inkFaint }]}>{l.passwordHint}</Text> : null}
                </View>
              ) : null}
              {mode === "signup" ? (
                <>
                  {input({ label: l.repeatPassword, value: repeat, onChangeText: setRepeat, secureTextEntry: !show, autoComplete: "new-password" })}
                  <Consent
                    checked={consent.terms}
                    onToggle={() => setConsent((c) => ({ ...c, terms: !c.terms }))}
                    text={l.consentTerms}
                    links={{ terms: [l.consentTermsLink, () => openLegal("terms", locale)], privacy: [l.consentPrivacyLink, () => openLegal("privacy", locale)] }}
                  />
                  <Consent checked={consent.health} onToggle={() => setConsent((c) => ({ ...c, health: !c.health }))} text={l.consentHealth} />
                </>
              ) : null}
              {error ? <T style={{ color: color.risk, fontSize: 13 }}>{error}</T> : null}
              {unconfirmed && email.trim() ? (
                <View style={{ gap: 6 }}>
                  {link(l.resendConfirmation, () => void resend())}
                  {resent ? <T kind="soft" style={{ fontSize: 13 }}>{resent}</T> : null}
                </View>
              ) : null}
              <Button
                label={busy ? t.mobile.signIn.pending : mode === "signin" ? l.signIn : mode === "signup" ? l.createAccount : l.sendResetLink}
                busy={busy}
                onPress={() => void submit()}
              />
              {mode !== "forgot" && providers.size > 0 ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 2 }}>
                    <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.line }} />
                    <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkFaint }}>{l.or}</Text>
                    <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.line }} />
                  </View>
                  {providers.has("apple") ? <ProviderButton provider="apple" label={l.continueWithApple} disabled={busy} onPress={() => void oauth("apple")} /> : null}
                  {providers.has("google") ? <ProviderButton provider="google" label={l.continueWithGoogle} disabled={busy} onPress={() => void oauth("google")} /> : null}
                </>
              ) : null}
              <View style={{ alignItems: "center", gap: 10, marginTop: 6 }}>
                {mode === "signin" ? (
                  <>
                    {link(l.forgotPassword, () => switchMode("forgot"))}
                    {link(l.switchToSignUp, () => switchMode("signup"))}
                  </>
                ) : mode === "signup" ? (
                  link(l.switchToSignIn, () => switchMode("signin"))
                ) : (
                  link(l.backToSignIn, () => switchMode("signin"))
                )}
              </View>
            </Card>
          )}
          <View style={{ marginTop: 18, flexDirection: "row", justifyContent: "center", gap: 18 }}>
            {link(t.mobile.more.privacy, () => openLegal("privacy", locale))}
            {link(l.consentTermsLink, () => openLegal("terms", locale))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** One consent box (ConsentChecks): "{terms}" and "{privacy}" in the text become links to the documents. */
function Consent({ checked, onToggle, text, links }: {
  checked: boolean; onToggle: () => void; text: string; links?: Record<"terms" | "privacy", [string, () => void]>;
}) {
  const { color } = useTheme();
  const parts = links ? text.split(/(\{terms\}|\{privacy\})/) : [text];
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        hitSlop={8}
        style={{ marginTop: 1, width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", borderColor: checked ? color.accent : color.inkFaint, backgroundColor: checked ? color.accent : "transparent" }}
      >
        {checked ? <NavIcon d={CHECK} size={14} color={color.accentFg} strokeWidth={2.4} /> : null}
      </Pressable>
      <Text onPress={onToggle} style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft }}>
        {parts.map((part, i) => {
          const key = part === "{terms}" ? "terms" : part === "{privacy}" ? "privacy" : null;
          if (!key || !links) return part;
          const [label, open] = links[key];
          return <Text key={i} accessibilityRole="link" onPress={open} style={{ fontFamily: font.semibold, color: color.ink, textDecorationLine: "underline" }}>{label}</Text>;
        })}
      </Text>
    </View>
  );
}

/**
 * "Continue with Apple / Google" (the web's AppleButton / GoogleButton). Apple's
 * guidelines want a solid button with its mark, listed first; Google's "G" keeps
 * its four brand colours, which Google's guidelines fix.
 */
function ProviderButton({ provider, label, disabled, onPress }: { provider: OAuthProvider; label: string; disabled: boolean; onPress: () => void }) {
  const { color } = useTheme();
  const apple = provider === "apple";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.provider,
        { borderColor: apple ? color.ink : color.line, backgroundColor: apple ? color.ink : color.bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {apple ? (
        <Svg width={16} height={18} viewBox="0 0 814 1000">
          <Path fill={color.bg} d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-157 124s-87-40-166-40c-77 0-104 41-167 41s-107-58-157-129C40 788 0 664 0 547 0 359 122 259 242 259c64 0 117 42 157 42 38 0 98-45 171-45 28 0 128 3 194 85zM549 154c30-36 51-85 51-135 0-7-1-14-2-19-48 2-106 32-140 73-27 31-53 80-53 131 0 8 1 15 2 18 3 1 9 2 14 2 43 0 97-29 128-70z" />
        </Svg>
      ) : (
        <Svg width={18} height={18} viewBox="0 0 48 48">
          <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </Svg>
      )}
      <Text style={{ fontFamily: font.semibold, fontSize: 14.5, color: apple ? color.bg : color.ink }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  provider: { height: 44, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  lang: { position: "absolute", top: 16, right: 16, zIndex: 2 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  segmentItem: { width: 46, height: 42, alignItems: "center", justifyContent: "center" },
  body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 40 },
  field: { height: 44, borderRadius: 16, paddingHorizontal: 14, fontSize: 15, fontFamily: font.regular },
  eye: { position: "absolute", right: 6, top: 0, height: 44, width: 40, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: font.semibold, fontSize: 12.5 },
  hint: { marginTop: 4, fontFamily: font.regular, fontSize: 11.5 },
  role: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 12 },
  pill: { flex: 1, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
