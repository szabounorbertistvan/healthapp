import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Logo, NavIcon, T } from "@/components/ui";
import { signInWithPassword, type SignInError } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6";
const EYE_OFF = "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6";

// The web's /login on the phone (components/login-form.tsx, sign-in mode): the
// language switch top right, the logo, one glass card with the two fields, the
// gold "Sign in", then "Forgot your password?" and "New here? Create an
// account" — both on voinic.fit, where sign-up asks for what the app does not.
export default function SignIn() {
  const { t, locale, setLocale } = useI18n();
  const { color } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);

  const messages: Record<SignInError, string> = {
    missing: t.mobile.signIn.errMissing,
    invalid: t.mobile.signIn.errInvalid,
    unconfirmed: t.mobile.signIn.errUnconfirmed,
    network: t.mobile.signIn.errNetwork,
  };

  async function submit() {
    setBusy(true);
    setError(null);
    // On success the auth listener swaps this screen for the tabs (app/_layout.tsx).
    const failure = await signInWithPassword(email, password);
    setBusy(false);
    setError(failure);
  }

  const field = [styles.field, { color: color.ink, backgroundColor: color.bg }];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.lang}>
        <View style={[styles.segment, { borderColor: color.line, backgroundColor: color.surface }]}>
          {(["en", "ro"] as const).map((l) => (
            <Pressable
              key={l}
              accessibilityRole="button"
              accessibilityState={{ selected: locale === l }}
              onPress={() => setLocale(l)}
              style={[styles.segmentItem, { backgroundColor: locale === l ? color.accent : "transparent" }]}
            >
              <Text style={{ fontFamily: font.bold, fontSize: 13, color: locale === l ? color.accentFg : color.inkSoft }}>{l.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: 28 }}>
            <Logo height={22} />
          </View>
          <Card style={{ padding: 20, gap: 12 }}>
            <TextInput
              accessibilityLabel={t.login.email}
              placeholder={t.login.email}
              placeholderTextColor={color.inkFaint}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              style={field}
            />
            <View>
              <TextInput
                accessibilityLabel={t.login.password}
                placeholder={t.login.password}
                placeholderTextColor={color.inkFaint}
                autoComplete="current-password"
                secureTextEntry={!show}
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={submit}
                returnKeyType="go"
                style={[field, { paddingRight: 48 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={show ? t.login.hidePassword : t.login.showPassword}
                onPress={() => setShow((v) => !v)}
                style={styles.eye}
              >
                <NavIcon d={show ? EYE_OFF : EYE} size={20} color={color.inkFaint} />
              </Pressable>
            </View>
            {error ? <T style={{ color: color.risk, fontSize: 13 }}>{messages[error]}</T> : null}
            <Button label={busy ? t.mobile.signIn.pending : t.login.signIn} busy={busy} onPress={submit} />
            <View style={{ alignItems: "center", gap: 10, marginTop: 6 }}>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/login`)}>
                <T kind="soft" style={{ fontSize: 14 }}>{t.login.forgotPassword}</T>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/login?mode=signup`)}>
                <T kind="soft" style={{ fontSize: 14 }}>{t.login.switchToSignUp}</T>
              </Pressable>
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  lang: { position: "absolute", top: 16, right: 16, zIndex: 2 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  segmentItem: { width: 46, height: 42, alignItems: "center", justifyContent: "center" },
  body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 40 },
  field: { height: 44, borderRadius: 16, paddingHorizontal: 14, fontSize: 15, fontFamily: font.regular },
  eye: { position: "absolute", right: 6, top: 0, height: 44, width: 40, alignItems: "center", justifyContent: "center" },
});
