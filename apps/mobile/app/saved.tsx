import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PostCard } from "@/components/post-card";
import { Button, NavIcon, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Saved — the web's /saved on a phone: the posts you bookmarked, newest save
// first, on the same save-time cursor. Only you see the list; unsaving a card
// takes it away at once.

const BOOKMARK = "M6 3h12v18l-6-4.5L6 21z";

export default function Saved() {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const query = useInfiniteQuery({
    queryKey: ["feed", "saved"],
    queryFn: ({ pageParam }) => api.savedPosts(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <View>
          <Text style={{ fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{s.savedTitle}</Text>
          <Text style={{ marginTop: 4, fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{s.savedHint}</Text>
        </View>

        {query.isLoading ? (
          <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : query.isError ? (
          <T kind="soft">{t.mobile.errors.offline}</T>
        ) : items.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface, borderColor: color.line }]}>
            <View style={[styles.badge, { backgroundColor: color.accentSoft }]}>
              <NavIcon d={BOOKMARK} size={24} color={color.accentInk} />
            </View>
            <Text style={{ marginTop: 16, fontFamily: font.displayBold, fontSize: 18, color: color.ink, textAlign: "center" }}>{s.savedEmptyTitle}</Text>
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft, textAlign: "center" }}>{s.savedEmptyHint}</Text>
            <View style={{ marginTop: 20 }}>
              <Button height={44} label={s.feed} onPress={() => router.replace("/feed")} />
            </View>
          </View>
        ) : (
          items.map((p) => <PostCard key={p.id} post={p} removeOnUnsave />)
        )}

        {query.hasNextPage ? (
          <Pressable
            accessibilityRole="button"
            disabled={query.isFetchingNextPage}
            onPress={() => void query.fetchNextPage()}
            style={[styles.more, { backgroundColor: color.surface, borderColor: color.line, opacity: query.isFetchingNextPage ? 0.5 : 1 }]}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{s.loadMore}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  empty: { alignItems: "center", borderRadius: 16, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 40 },
  badge: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  more: { height: 44, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
