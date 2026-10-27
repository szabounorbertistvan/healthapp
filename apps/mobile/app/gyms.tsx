import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GymMap } from "@/components/gym-map";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Gyms — the web's /gyms on a phone: your gym first, then the gyms in your
// town best rated first (the list under the web's map), and a search over all
// of them. The map itself opens on voinic.fit.

type Row = { id: string; name: string; city: string; google_rating?: number | null; members: number; coaches: number };

export default function Gyms() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const h = t.gyms.hub;
  const query = useQuery({ queryKey: ["gyms"], queryFn: api.gyms });
  const [mapOpen, setMapOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(id);
  }, [typed]);
  const search = useQuery({ queryKey: ["gyms", "search", q], queryFn: () => api.searchGyms(q), enabled: q.length >= 2 });
  const data = query.data;
  const rows: Row[] = q.length >= 2 ? (search.data ?? []) : (data?.items ?? []);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View>
          <T kind="title">{h.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft }}>{h.intro}</Text>
        </View>

        {data?.home ? (
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/gym/[id]", params: { id: data.home!.id } })} style={[styles.home, { backgroundColor: color.accentSoft }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: color.accentInk }}>{h.myGym}</Text>
            <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.displayBold, fontSize: 17, color: color.ink }}>{data.home.name}</Text>
            <Text numberOfLines={1} style={{ fontFamily: font.regular, fontSize: 12.5, color: color.inkSoft }}>{data.home.city}</Text>
          </Pressable>
        ) : null}

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            autoCorrect={false}
            placeholder={t.gyms.my.searchPlaceholder}
            placeholderTextColor={color.inkFaint}
            accessibilityLabel={t.gyms.my.searchPlaceholder}
            style={[styles.search, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
          />
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: mapOpen }} onPress={() => setMapOpen((v) => !v)} style={[styles.map, { backgroundColor: mapOpen ? color.accent : color.surface }]}>
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: mapOpen ? color.accentFg : color.inkSoft }}>{h.tabMap}</Text>
          </Pressable>
        </View>
        {mapOpen && data?.pins ? <GymMap pins={data.pins} homeId={data.home?.id ?? null} /> : null}

        {!data ? (
          query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : (
          <View style={{ gap: 8 }}>
            <T kind="label">{q.length >= 2 ? h.list : data.city ? fill(h.listIn, { city: data.city }) : h.listTop}</T>
            {q.length >= 2 && search.isFetching && !search.data ? <ActivityIndicator color={color.accent} /> : null}
            {rows.length === 0 && (q.length < 2 || search.data) ? <T kind="faint">{h.empty}</T> : null}
            {rows.map((p) => (
              <Pressable key={p.id} accessibilityRole="link" onPress={() => router.push({ pathname: "/gym/[id]", params: { id: p.id } })} style={[styles.row, { backgroundColor: color.surface }]}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{p.name}</Text>
                <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12.5, color: color.inkFaint }}>
                  {[p.google_rating != null ? `★ ${p.google_rating.toFixed(1)}` : null, p.city, p.members > 0 ? fill(h.members, { n: p.members }) : null, p.coaches > 0 ? fill(h.coaches, { n: p.coaches }) : null].filter(Boolean).join(" · ")}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  home: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12 },
  search: { flex: 1, height: 46, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14 },
  map: { height: 46, borderRadius: 16, paddingHorizontal: 14, justifyContent: "center" },
  row: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
});
