import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { absolute } from "@/components/post-card";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The exercise library — the web's /exercises (and the coach's /library) on a
// phone: search by name, a muscle, 60 at a time; each opens its page with the
// how-to and your own history of it (app/exercise/[id].tsx).

const MUSCLE_GROUPS = [
  "chest", "lats", "middle back", "lower back", "shoulders", "traps",
  "biceps", "triceps", "forearms", "abdominals", "quadriceps", "hamstrings",
  "glutes", "calves", "adductors", "abductors", "neck",
] as const;

export default function Exercises() {
  const { t, fill } = useI18n();
  const { color } = useTheme();
  const l = t.clientApp.library;
  const p = t.coachWidgets.exercisePicker;
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(id);
  }, [typed]);
  const query = useInfiniteQuery({
    queryKey: ["exercise-library", q, muscle],
    queryFn: ({ pageParam }) => api.searchExercises(q, muscle, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const seen = pages.reduce((n, pg) => n + pg.results.length, 0);
      return seen < last.total && last.results.length > 0 ? seen : undefined;
    },
  });
  const results = query.data?.pages.flatMap((pg) => pg.results) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <BackHeader label={t.common.nav.training} />
        <View>
          <T kind="title">{l.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.inkFaint }}>{l.hint}</Text>
        </View>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          autoCorrect={false}
          placeholder={p.searchPlaceholder}
          placeholderTextColor={color.inkFaint}
          accessibilityLabel={p.searchPlaceholder}
          style={[styles.search, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
          {["", ...MUSCLE_GROUPS].map((g) => {
            const on = g === muscle;
            return (
              <Pressable key={g || "all"} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setMuscle(g)} style={[styles.chip, { backgroundColor: on ? color.accent : color.surface }]}>
                <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft, textTransform: g ? "capitalize" : "none" }}>{g || p.allMuscles}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>
          {query.isLoading ? p.searching : fill(total === 1 ? p.exercisesOne : p.exercisesMany, { n: total })}
        </Text>
        {query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : null}
        {query.data && results.length === 0 ? <T kind="faint">{t.mobile.builder.noMatch}</T> : null}
        <View style={{ gap: 8 }}>
          {results.map((x) => (
            <Pressable key={x.id} accessibilityRole="link" onPress={() => router.push({ pathname: "/exercise/[id]", params: { id: x.id } })} style={[styles.row, { backgroundColor: color.surface }]}>
              {x.image ? <Image source={{ uri: absolute(x.image) }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: color.bg }]} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{x.name}</Text>
                <Text numberOfLines={1} style={{ marginTop: 2, fontFamily: font.regular, fontSize: 12, color: color.inkFaint, textTransform: "capitalize" }}>
                  {[x.primary_muscles.join(", "), x.equipment, x.mine ? p.mine : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        {query.hasNextPage ? (
          <Pressable accessibilityRole="button" disabled={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} style={[styles.more, { borderColor: color.line, opacity: query.isFetchingNextPage ? 0.5 : 1 }]}>
            {query.isFetchingNextPage ? <ActivityIndicator color={color.accent} /> : <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{p.loadMore}</Text>}
          </Pressable>
        ) : null}
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{l.source}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 12 },
  search: { height: 46, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14 },
  chip: { height: 34, borderRadius: 17, paddingHorizontal: 13, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 10 },
  thumb: { width: 52, height: 52, borderRadius: 12 },
  more: { height: 44, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
});
