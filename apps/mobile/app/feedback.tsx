import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorText, Primary, Small } from "@/components/coach-profile-bits";
import { Card, NavIcon } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// "Send feedback" — the web's FeedbackButton dialog as a screen, opened from
// the More sheet of both shells. The screen the person came from travels with
// the message (?from=); the rows land on /admin/feedback and nowhere else.

type Kind = "bug" | "idea" | "other";
const KINDS: Kind[] = ["bug", "idea", "other"];
const ICON = "M4 5h16v11H9l-5 4zM12 8v3M12 13.5h.01";

export default function Feedback() {
  const { t } = useI18n();
  const { color } = useTheme();
  const f = t.common.feedback;
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [kind, setKind] = useState<Kind>("bug");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setError(null);
    if (!text.trim()) return setError(f.empty);
    setBusy(true);
    try {
      const r = await api.sendFeedback(kind, text, from ?? "");
      if (r.ok) {
        setSent(true);
        setText("");
        return;
      }
      setError(r.reason === "rate" ? f.rate : r.reason === "empty" ? f.empty : f.failed);
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : f.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48, gap: 16 }} keyboardShouldPersistTaps="handled">
        <BackHeader label={t.common.nav.more} />
        {sent ? (
          <Card style={{ gap: 10, alignItems: "flex-start" }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.displayBold, fontSize: 20, color: color.ink }}>{f.thanksTitle}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: color.inkSoft }}>{f.thanksBody}</Text>
            <Primary label={f.close} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
          </Card>
        ) : (
          <Card style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <NavIcon d={ICON} color={color.accentInk} />
              <Text accessibilityRole="header" style={{ flex: 1, fontFamily: font.displayBold, fontSize: 20, color: color.ink }}>{f.title}</Text>
            </View>
            <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{f.intro}</Text>
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", borderRadius: 14, padding: 4, backgroundColor: color.bg }}>
              {KINDS.map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: kind === k }}
                  onPress={() => setKind(k)}
                  style={{ flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: kind === k ? color.accentSoft : "transparent" }}
                >
                  <Text style={{ fontFamily: font.semibold, fontSize: 13, color: kind === k ? color.accentInk : color.inkSoft }}>{f.kinds[k]}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              maxLength={4000}
              placeholder={f.placeholder[kind]}
              placeholderTextColor={color.inkFaint}
              accessibilityLabel={f.title}
              style={{ minHeight: 140, borderRadius: 12, borderWidth: 1, borderColor: color.line, backgroundColor: color.bg, padding: 14, textAlignVertical: "top", fontFamily: font.regular, fontSize: 14, color: color.ink }}
            />
            {error ? <ErrorText>{error}</ErrorText> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Primary label={busy ? f.sending : f.send} busy={busy} onPress={() => void submit()} />
              <Small label={f.cancel} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
