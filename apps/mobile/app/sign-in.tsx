import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Screen, T } from "@/components/ui";
import { signInWithPassword, type SignInError } from "@/lib/auth";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

export default function SignIn() {
  const { t } = useI18n();
  const { color } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const field = [styles.field, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }];

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <T kind="accent" style={styles.brand}>VOINIC</T>
            <T kind="title">{t.mobile.signIn.title}</T>
            <T kind="soft">{t.mobile.signIn.subtitle}</T>

            <View style={{ gap: space.md, marginTop: space.lg }}>
              <TextInput
                accessibilityLabel={t.mobile.signIn.email}
                placeholder={t.mobile.signIn.email}
                placeholderTextColor={color.inkFaint}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                value={email}
                onChangeText={setEmail}
                style={field}
              />
              <TextInput
                accessibilityLabel={t.mobile.signIn.password}
                placeholder={t.mobile.signIn.password}
                placeholderTextColor={color.inkFaint}
                autoComplete="current-password"
                secureTextEntry
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={submit}
                returnKeyType="go"
                style={field}
              />
              {error ? (
                <T style={{ color: color.risk }} >{messages[error]}</T>
              ) : null}
              <Button label={busy ? t.mobile.signIn.pending : t.mobile.signIn.submit} busy={busy} onPress={submit} />
            </View>

            <View style={{ gap: space.sm, marginTop: space.xl }}>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/login?mode=forgot`)}>
                <T kind="accent">{t.mobile.signIn.forgot}</T>
              </Pressable>
              <T kind="faint">{t.mobile.signIn.noAccount}</T>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${config.webUrl}/login?mode=signup`)}>
                <T kind="accent">{t.mobile.signIn.createOnWeb}</T>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.xl, gap: space.sm, flexGrow: 1, justifyContent: "center" },
  brand: { letterSpacing: 4, marginBottom: space.lg },
  field: {
    minHeight: minTouchTarget + 4,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    fontSize: fontSize.base,
  },
});
