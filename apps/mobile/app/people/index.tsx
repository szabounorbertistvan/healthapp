import type { PersonV1 } from "@healthapp/api/v1";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PeopleList } from "@/components/people";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Discover people — the web's /people on a phone: search by name, handle or
// city (either half is enough with two letters), paged; suggestions while
// nothing is searched for. The suggestions are counts over public follow
// edges, never anything about anyone's training, food or body.

export default function People() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState({ q: "", city: "" });
  // the list follows the typing, a moment after it stops
  useEffect(() => {
    const timer = setTimeout(() => { setTyped({ q: q.trim(), city: city.trim() }); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [q, city]);
  const query = new URLSearchParams({ q: typed.q, city: typed.city, page: String(page) }).toString();
  const data = useQuery({ queryKey: ["people", query], queryFn: () => api.people(query), placeholderData: (p) => p });

  // why this person is here: shared connections, else their followers; handle and city in front
  const detail = (p: PersonV1) => {
    const reason = p.mutuals ? fill(s.mutualsCount, { count: p.mutuals }) : p.followers ? (p.followers === 1 ? s.followersCountOne : fill(s.followersCount, { count: p.followers })) : "";
    return [p.username && p.username !== p.name ? `@${p.username}` : "", p.city ?? "", reason].filter(Boolean).join(" · ");
  };
  const input = [styles.input, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }];
  const r = data.data?.results ?? null;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={data.isRefetching} onRefresh={() => void data.refetch()} tintColor={color.accent} />}>
        <BackHeader label={s.feed} />
        <T kind="title">{s.people}</T>
        <TextInput value={q} onChangeText={setQ} placeholder={s.searchPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={s.searchPlaceholder} autoCapitalize="none" autoCorrect={false} style={input} />
        <TextInput value={city} onChangeText={setCity} placeholder={s.cityFilter} placeholderTextColor={color.inkFaint} accessibilityLabel={s.cityFilter} style={input} />
        {!data.data ? (
          data.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 24 }} />
        ) : !r ? (
          data.data.suggested.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={{ fontFamily: font.bold, fontSize: 12, letterSpacing: 0.7, textTransform: "uppercase", color: color.inkSoft }}>{s.suggested}</Text>
              <PeopleList people={data.data.suggested} detail={detail} />
            </View>
          ) : <T kind="faint">{s.searchHint}</T>
        ) : r.items.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface, borderColor: color.line }]}><Text style={{ fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft, textAlign: "center" }}>{s.noResults}</Text></View>
        ) : (
          <>
            <PeopleList people={r.items} detail={detail} />
            {r.hasMore || r.page > 1 ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                {r.page > 1 ? (
                  <Pressable accessibilityRole="button" onPress={() => setPage(r.page - 1)} style={[styles.page, { backgroundColor: color.surface, borderColor: color.line }]}>
                    <Text style={{ fontFamily: font.semibold, color: color.inkSoft }}>←</Text>
                  </Pressable>
                ) : <View />}
                {r.hasMore ? (
                  <Pressable accessibilityRole="button" onPress={() => setPage(r.page + 1)} style={[styles.page, { backgroundColor: color.surface, borderColor: color.line }]}>
                    <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{s.peopleMore}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 12 },
  input: { height: 44, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14 },
  empty: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 40 },
  page: { height: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, justifyContent: "center" },
});
