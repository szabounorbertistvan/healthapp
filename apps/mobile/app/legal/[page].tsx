import { LEGAL, parseInline, type LegalPage } from "@healthapp/i18n/legal";
import { router, useLocalSearchParams } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The Terms and the Privacy Policy, in the app — the same text the web's /terms
// and /privacy render (@healthapp/i18n/legal), in the app's language. Open to a
// signed-out reader too: sign-up links here before an account exists.

export default function LegalScreen() {
  const { page } = useLocalSearchParams<{ page: string }>();
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const doc = LEGAL[(page === "privacy" ? "privacy" : "terms") satisfies LegalPage][locale];

  const inline = (text: string) =>
    parseInline(text, { app: config.appName, email: config.contactEmail }).map((s, i) => {
      if (s.href) {
        const href = s.href;
        // /privacy, /terms → this screen; mailto: → the mail app; anything else is another site
        const onPress = href.startsWith("/") ? () => router.push(`/legal/${href.slice(1)}` as never) : () => void Linking.openURL(href);
        return <Text key={i} accessibilityRole="link" onPress={onPress} style={{ fontFamily: font.semibold, color: color.accentInk }}>{s.text}</Text>;
      }
      if (s.bold) return <Text key={i} style={{ fontFamily: font.bold, color: color.ink }}>{s.text}</Text>;
      if (s.italic) return <Text key={i} style={{ fontStyle: "italic" }}>{s.text}</Text>;
      if (s.code) return <Text key={i} style={{ fontFamily: "monospace" }}>{s.text}</Text>;
      return s.text;
    });
  const body = { fontFamily: font.regular, fontSize: 15, lineHeight: 24, color: color.inkSoft } as const;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body}>
        <BackHeader label={t.common.actions.back} />
        <View style={{ gap: 4 }}>
          <T kind="title">{doc.title}</T>
          <T kind="faint">{doc.updated}</T>
        </View>
        {doc.sections.map((s) => (
          <View key={s.h} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontFamily: font.bold, fontSize: 17, color: color.ink }}>{s.h}</Text>
            {s.blocks.map((b, i) => {
              if ("cookieSettings" in b) return null;
              if ("ul" in b) {
                return (
                  <View key={i} style={{ gap: 4 }}>
                    {b.ul.map((li, j) => (
                      <View key={j} style={{ flexDirection: "row", gap: 8, paddingLeft: 4 }}>
                        <Text style={body}>•</Text>
                        <Text style={[body, { flex: 1 }]}>{inline(li)}</Text>
                      </View>
                    ))}
                  </View>
                );
              }
              return <Text key={i} style={body}>{inline(b.p)}</Text>;
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48, gap: 24 },
});
