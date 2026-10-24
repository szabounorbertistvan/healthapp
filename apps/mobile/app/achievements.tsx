import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { font, useTheme } from "@/lib/theme";

// Achievements — the web's /achievements on a phone: the count, a category
// filter, then one card per badge with its rarity, what it asks for and —
// until it is earned — the progress toward it. Every word and number comes
// from the server (achievement_progress, worded by the web's own helpers).

/** social-v2.tsx BADGE_GLYPH: the catalog's icon names; unknown ones fall back to the trophy. */
const BADGE_GLYPH: Record<string, string> = {
  dumbbell: "M6.5 6.5v11M9.5 8.5v7M14.5 8.5v7M17.5 6.5v11M9.5 12h5",
  flame: "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  check: "m5 12 5 5 9-10",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01",
  food: "M7 3v8a3 3 0 0 0 6 0V3M10 3v18M17 3c-1.5 1-2 3-2 6s.5 4 2 4v8",
  weight: "M6 20h12l-2-11H8zM9.5 9a2.5 2.5 0 1 1 5 0",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h.01",
  barbell: "M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8",
};

export default function Achievements() {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const a = t.common.achievements;
  const query = useOfflineQuery("achievements", ["achievements"], api.achievements);
  const data = query.data?.data;
  const [category, setCategory] = useState<string | null>(null);
  const df = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const rarityTone: Record<string, { bg: string; ink: string }> = {
    common: { bg: color.surface, ink: color.inkSoft },
    rare: { bg: color.accentSoft, ink: color.accentInk },
    epic: { bg: color.warnSoft, ink: color.warn },
    legendary: { bg: color.accent, ink: color.accentFg },
  };

  const chip = (key: string | null, label: string) => {
    const on = category === key;
    return (
      <Pressable key={key ?? "all"} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setCategory(key)} style={[styles.chip, { backgroundColor: on ? color.ink : color.surface }]}>
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.bg : color.inkSoft }}>{label}</Text>
      </Pressable>
    );
  };
  const rows = (data?.rows ?? []).filter((r) => category === null || r.category === category);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View>
          <T kind="title">{a.title}</T>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{a.subtitle}</Text>
          {data ? <Text style={{ marginTop: 12, fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{fill(a.earnedOf, { earned: data.earned, total: data.total })}</Text> : null}
        </View>
        {data ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {chip(null, a.all)}
            {data.categories.map((c) => chip(c.key, c.label))}
          </ScrollView>
        ) : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : rows.length === 0 ? (
          <T kind="faint">{a.noneInCategory}</T>
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((r) => {
              const earned = r.awarded_at !== null;
              const tone = rarityTone[r.rarity];
              return (
                <View key={r.slug} style={[styles.card, { backgroundColor: color.surface }]}>
                  <View style={[styles.badge, { backgroundColor: earned ? color.accent : color.bg }]}>
                    <NavIcon d={BADGE_GLYPH[r.icon ?? ""] ?? BADGE_GLYPH.trophy!} size={20} color={earned ? color.accentFg : color.inkFaint} strokeWidth={2.1} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 13.5, lineHeight: 18, color: earned ? color.ink : color.inkSoft }}>{r.name}</Text>
                      {r.rarity_label && tone ? (
                        <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: tone.bg }}>
                          <Text style={{ fontFamily: font.bold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: tone.ink }}>{r.rarity_label}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.inkFaint }}>{r.requirement}</Text>
                    {earned ? (
                      <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 11.5, color: color.accentInk }}>{fill(a.earnedOn, { date: df.format(new Date(r.awarded_at!)) })}</Text>
                    ) : r.target > 1 ? (
                      <View style={{ marginTop: 8 }}>
                        <View style={{ height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: color.bg }}>
                          <View style={{ height: "100%", borderRadius: 999, width: `${Math.min(100, r.percent)}%`, backgroundColor: r.percent >= 50 ? color.accent : color.inkSoft }} />
                        </View>
                        <View style={{ marginTop: 4, flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{r.progress_line}</Text>
                          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`${r.percent}%`}</Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={{ marginTop: 8, fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{a.notEarned}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  chip: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
  card: { flexDirection: "row", gap: 12, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14 },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
