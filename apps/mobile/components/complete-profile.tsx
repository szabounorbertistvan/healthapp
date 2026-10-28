import type { MeV1 } from "@healthapp/api/v1";
import { isValidAge, isValidUsername, SEXES } from "@healthapp/shared/account/profile";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorText, Primary } from "@/components/coach-profile-bits";
import { Card, Logo, NavIcon } from "@/components/ui";
import { api, ApiFailure } from "@/lib/api";
import { signOut, useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { openLegal } from "@/lib/legal";
import { font, useTheme } from "@/lib/theme";

const CHECK = "M5 12.5l4.5 4.5L19 7.5";
type Sex = (typeof SEXES)[number];

/** The web's rule (both layouts): no username yet, or the current consent not recorded → this step first. */
export function needsProfile(me: MeV1 | undefined): boolean {
  return Boolean(me && (me.username === null || me.consent_ok === false));
}

/**
 * The web's /complete-profile on the phone (components/complete-profile-form.tsx):
 * a Google sign-up gives its name, username, sex, age and role; an account that
 * has them but not the current consent only ticks the two boxes. Shown in place
 * of the tabs until it is done, with sign-out as the way out.
 */
export function CompleteProfile({ me }: { me: MeV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const l = t.login;
  const m = t.clientApp.completeProfile;
  const consentOnly = me.username !== null;
  const askRole = me.role !== "admin";
  const [fullName, setFullName] = useState("");
  // the name Google or Apple gave the account, as a start (never the email the sign-up trigger falls back to);
  // Apple's arrives a moment after the sign-in (lib/oauth.ts), hence an effect
  const givenName = useAuth().session?.user.user_metadata?.full_name;
  useEffect(() => {
    if (typeof givenName === "string" && givenName.trim() && !givenName.includes("@")) setFullName((f) => f || givenName.trim());
  }, [givenName]);
  const [username, setUsername] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const [age, setAge] = useState("");
  const [role, setRole] = useState<"client" | "coach">(me.role === "coach" ? "coach" : "client");
  const [consent, setConsent] = useState({ terms: false, health: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!consentOnly) {
      if (!fullName.trim()) return m.errName;
      if (!isValidUsername(username)) return m.errUsernameFormat;
      if (!sex) return m.errSex;
      if (!isValidAge(parseInt(age, 10))) return m.errAge;
    }
    if (!consent.terms || !consent.health) return l.errConsent;
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      const r = consentOnly
        ? await api.completeProfile({ op: "consent" })
        : await api.completeProfile({ op: "complete", fullName, username, sex, age: parseInt(age, 10), role: askRole ? role : "client" });
      if (!r.ok) {
        setError(
          r.errorCode === "USERNAME_TAKEN" ? m.errUsernameTaken
            : r.errorCode === "USERNAME_FORMAT" ? m.errUsernameFormat
              : r.errorCode === "AGE" ? m.errAge
                : r.errorCode === "SEX" ? m.errSex
                  : r.errorCode === "NAME" ? m.errName
                    : m.errGeneric,
        );
        return;
      }
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.common.actions.unreachable);
    } finally {
      setBusy(false);
    }
  }

  const field = { height: 44, borderRadius: 16, paddingHorizontal: 14, fontSize: 15, fontFamily: font.regular, color: color.ink, backgroundColor: color.bg } as const;
  const label = { fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft } as const;
  const [before, rest = ""] = l.consentTerms.split("{terms}");
  const [between, after = ""] = rest.split("{privacy}");

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: 24 }}><Logo height={22} /></View>
          <Card style={{ padding: 20, gap: 12 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.displayBold, fontSize: 20, color: color.ink }}>{consentOnly ? l.consentTitle : m.title}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{consentOnly ? l.consentBody : m.body}</Text>
            {!consentOnly ? (
              <>
                {askRole ? (
                  <>
                    <Text style={label}>{l.iAm}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["client", "coach"] as const).map((r) => {
                        const on = role === r;
                        return (
                          <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setRole(r)}
                            style={{ flex: 1, borderWidth: 1, borderRadius: 16, padding: 12, borderColor: on ? color.accent : color.line, backgroundColor: on ? color.accentSoft : color.bg }}>
                            <Text style={{ fontFamily: font.bold, fontSize: 14, color: on ? color.accentInk : color.ink }}>{r === "coach" ? l.roleCoach : l.roleClient}</Text>
                            <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: color.inkSoft }}>{r === "coach" ? l.roleCoachBody : l.roleClientBody}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                <TextInput accessibilityLabel={m.fullName} placeholder={m.fullName} placeholderTextColor={color.inkFaint} value={fullName} onChangeText={setFullName} autoComplete="name" style={field} />
                <View>
                  <TextInput accessibilityLabel={m.username} placeholder={m.username} placeholderTextColor={color.inkFaint} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} style={field} />
                  <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{m.usernameHint}</Text>
                </View>
                <View>
                  <Text style={label}>{m.sex}</Text>
                  <View style={{ marginTop: 6, flexDirection: "row", gap: 6 }}>
                    {SEXES.map((s) => (
                      <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: sex === s }} onPress={() => setSex(s)}
                        style={{ flex: 1, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: sex === s ? color.accent : color.bg }}>
                        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: sex === s ? color.accentFg : color.inkSoft }}>{s === "male" ? l.sexMale : s === "female" ? l.sexFemale : l.sexOther}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <TextInput accessibilityLabel={m.age} placeholder={m.age} placeholderTextColor={color.inkFaint} value={age} onChangeText={(v) => setAge(v.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" style={field} />
              </>
            ) : null}
            <Check checked={consent.terms} onToggle={() => setConsent((c) => ({ ...c, terms: !c.terms }))}>
              {before}
              <Text accessibilityRole="link" onPress={() => openLegal("terms")} style={{ fontFamily: font.semibold, color: color.ink, textDecorationLine: "underline" }}>{l.consentTermsLink}</Text>
              {between}
              <Text accessibilityRole="link" onPress={() => openLegal("privacy")} style={{ fontFamily: font.semibold, color: color.ink, textDecorationLine: "underline" }}>{l.consentPrivacyLink}</Text>
              {after}
            </Check>
            <Check checked={consent.health} onToggle={() => setConsent((c) => ({ ...c, health: !c.health }))}>{l.consentHealth}</Check>
            {error ? <ErrorText>{error}</ErrorText> : null}
            <Primary label={m.save} busy={busy} onPress={() => void save()} />
            <Text accessibilityRole="button" onPress={() => signOut().catch(() => {})} style={{ alignSelf: "center", marginTop: 4, fontFamily: font.semibold, fontSize: 13.5, color: color.inkFaint }}>{t.mobile.more.signOut}</Text>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Check({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onToggle} hitSlop={8}
        style={{ marginTop: 1, width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", borderColor: checked ? color.accent : color.inkFaint, backgroundColor: checked ? color.accent : "transparent" }}>
        {checked ? <NavIcon d={CHECK} size={14} color={color.accentFg} strokeWidth={2.4} /> : null}
      </Pressable>
      <Text onPress={onToggle} style={{ flex: 1, fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.inkSoft }}>{children}</Text>
    </View>
  );
}
