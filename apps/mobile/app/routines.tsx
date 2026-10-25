import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RoutineCardView } from "@/components/routine-card";
import { NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Programs — the web's /routines on a phone: My programs · Discover · Saved,
// Discover with its search and pages, and New program into the builder.

type Tab = "mine" | "discover" | "saved";

export default function Routines() {
  const { t } = useI18n();
  const { color } = useTheme();
  const r = t.clientApp.routines;
  const [tab, setTab] = useState<Tab>("mine");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => { setQ(typed.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [typed]);
  const query = useQuery({
    queryKey: ["routines", tab, tab === "discover" ? q : "", tab === "discover" ? page : 1],
    queryFn: () => api.routines(tab, tab === "discover" ? q : "", tab === "discover" ? page : 1),
  });
  const data = query.data;
  const empty =
    tab === "discover" ? { title: q ? r.noResults : r.emptyDiscoverTitle, hint: r.emptyDiscoverHint }
    : tab === "saved" ? { title: r.emptySavedTitle, hint: r.emptySavedHint }
    : { title: r.emptyMineTitle, hint: r.emptyMineHint };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T kind="title">{r.title}</T>
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{r.subtitle}</Text>
          </View>
          <Pressable accessibilityRole="link" onPress={() => router.push("/build")} style={[styles.new, { backgroundColor: color.accent }]}>
            <NavIcon d="M12 5v14M5 12h14" size={16} color={color.accentFg} strokeWidth={2.2} />
            <Text style={{ fontFamily: font.displayBold, fontSize: 13, color: color.accentFg }}>{r.newRoutine}</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {([["mine", r.mine], ["discover", r.discover], ["saved", r.saved]] as const).map(([key, label]) => {
            const on = key === tab;
            return (
              <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(key)} style={[styles.tab, { backgroundColor: on ? color.accent : color.surface }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: on ? color.accentFg : color.inkSoft }}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {tab === "discover" ? (
          <TextInput
            value={typed}
            onChangeText={setTyped}
            autoCorrect={false}
            placeholder={r.search}
            placeholderTextColor={color.inkFaint}
            accessibilityLabel={r.search}
            style={[styles.search, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
          />
        ) : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <>
            {data.featured.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentInk }}>{r.featuredShelf}</Text>
                {data.featured.map((card) => <RoutineCardView key={card.id} card={card} />)}
              </View>
            ) : null}
            {data.cards.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: color.surface }]}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: color.ink, textAlign: "center" }}>{empty.title}</Text>
                <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft, textAlign: "center" }}>{empty.hint}</Text>
              </View>
            ) : (
              data.cards.map((card) => <RoutineCardView key={card.id} card={card} />)
            )}
            {tab === "discover" && (page > 1 || data.has_more) ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                {page > 1 ? <PageButton label={r.previous} onPress={() => setPage(page - 1)} /> : <View />}
                <Text style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>{String(page)}</Text>
                {data.has_more ? <PageButton label={r.next} onPress={() => setPage(page + 1)} /> : <View />}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PageButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.tab, { backgroundColor: color.surface }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkSoft }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  new: { height: 40, borderRadius: 20, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6 },
  tab: { height: 40, borderRadius: 20, paddingHorizontal: 16, justifyContent: "center" },
  search: { height: 46, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14 },
  empty: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 40 },
});
