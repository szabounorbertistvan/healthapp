import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BADGE_GLYPH } from "@/components/badge-glyph";
import { Primary } from "@/components/coach-profile-bits";
import { Card, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { font, useTheme } from "@/lib/theme";

// One achievement, for its owner — the web's /achievements/[slug]: the
// requirement, the progress, when it was earned, how the metric is counted
// and, once earned, sharing it to the feed (to followers, as the web does).
// Read from the same list as /achievements; a slug outside it is "not found".
export default function Achievement() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const a = t.common.achievements;
  const s = t.common.social;
  const query = useOfflineQuery("achievements", ["achievements"], api.achievements);
  const row = query.data?.data.rows.find((r) => r.slug === slug);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

  async function share() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.shareAchievement(row.slug, "followers");
      if (!r.ok) return setError(r.message ?? t.mobile.errors.generic);
      setShared(true);
      void queryClient.invalidateQueries({ queryKey: ["achievements"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch {
      setError(t.mobile.errors.offline);
    } finally {
      setBusy(false);
    }
  }

  const label = (text: string) => (
    <Text style={{ fontFamily: font.bold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkSoft }}>{text}</Text>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 }}>
        <BackHeader label={a.title} />
        {!row ? (
          query.isLoading ? <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} /> : <T kind="soft">{t.coachProfile.publicPage.notFoundTitle}</T>
        ) : (
          <Card style={{ gap: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: row.awarded_at ? color.accent : color.bg }}>
                <NavIcon d={BADGE_GLYPH[row.icon ?? ""] ?? BADGE_GLYPH.trophy!} size={30} color={row.awarded_at ? color.accentFg : color.inkFaint} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text accessibilityRole="header" style={{ fontFamily: font.displayExtrabold, fontSize: 20, color: color.ink }}>{row.name}</Text>
                <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {row.rarity_label ? <Chip text={row.rarity_label} /> : null}
                  {row.category_label ? <Chip text={row.category_label} /> : null}
                </View>
              </View>
            </View>
            <View>
              {label(a.requirementLabel)}
              <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, color: color.ink }}>{row.requirement}</Text>
            </View>
            <View>
              {label(a.progressLabel)}
              <View style={{ marginTop: 8, height: 10, borderRadius: 999, overflow: "hidden", backgroundColor: color.bg }}>
                <View style={{ height: "100%", width: `${Math.min(100, row.percent)}%`, borderRadius: 999, backgroundColor: color.accent }} />
              </View>
              <View style={{ marginTop: 6, flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{row.progress_line}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{`${row.percent}%`}</Text>
              </View>
              {!row.awarded_at && row.remaining_line ? <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{row.remaining_line}</Text> : null}
            </View>
            <View>
              {label(a.earnedLabel)}
              <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, color: color.ink }}>
                {row.awarded_at ? fill(a.earnedOn, { date: df.format(new Date(row.awarded_at)) }) : a.notEarned}
              </Text>
            </View>
            {row.how_counted ? (
              <View>
                {label(a.howCounted)}
                <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{row.how_counted}</Text>
              </View>
            ) : null}
            {row.awarded_at ? (
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                {row.shared || shared
                  ? <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.accentInk }}>{s.achievementShared}</Text>
                  : <Primary label={s.shareAchievement} busy={busy} onPress={() => void share()} />}
                {error ? <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
              </View>
            ) : null}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ text }: { text: string }) {
  const { color } = useTheme();
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: color.bg }}>
      <Text style={{ fontFamily: font.bold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: color.inkSoft }}>{text}</Text>
    </View>
  );
}
