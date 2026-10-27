import type { PersonV1 } from "@healthapp/api/v1";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PeopleList } from "@/components/people";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// Who follows a person and whom they follow — the web's /people/[id]/followers
// and /following on a phone: the two lists as tabs with the server's counts, a
// search over the whole list, one page at a time.

export default function FollowList() {
  const { id, list } = useLocalSearchParams<{ id: string; list: "followers" | "following" }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTyped(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const pages = useInfiniteQuery({
    queryKey: ["follow-list", id, list, typed],
    queryFn: ({ pageParam }) => api.followList(id, list, new URLSearchParams({ ...(typed ? { q: typed } : {}), ...(pageParam ? { before: pageParam } : {}) }).toString()),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const first = pages.data?.pages[0];
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  // how this person relates to the viewer, when they relate at all; else their handle
  const detail = (p: PersonV1) => (p.is_following && p.follows_me ? s.relationMutual : p.follows_me ? s.relationFollowsYou : p.username && p.username !== p.name ? `@${p.username}` : "");
  const empty = typed ? s.noResults : list === "followers" ? (first?.me ? s.noFollowersMine : s.noFollowers) : first?.me ? s.noFollowingMine : s.noFollowing;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <BackHeader label={first?.name ?? s.people} />
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: color.line }}>
          {(["followers", "following"] as const).map((k) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: k === list }} onPress={() => k !== list && router.setParams({ list: k })}
              style={{ flex: 1, height: 48, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: k === list ? color.accent : "transparent", marginBottom: -1 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: k === list ? color.ink : color.inkFaint }}>
                {`${k === "followers" ? s.followers : s.followingCount}${first ? ` · ${k === "followers" ? first.followers : first.following}` : ""}`}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput value={q} onChangeText={setQ} placeholder={s.searchPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={s.searchPlaceholder} autoCapitalize="none" autoCorrect={false}
          style={{ height: 44, borderRadius: 16, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 14, color: color.ink }} />
        {!pages.data ? (
          pages.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, paddingHorizontal: 20, paddingVertical: 40 }}>
            <Text style={{ textAlign: "center", fontFamily: font.regular, fontSize: 13.5, color: color.inkSoft }}>{empty}</Text>
          </View>
        ) : (
          <>
            <PeopleList people={items} detail={detail} />
            {pages.hasNextPage ? (
              <Pressable accessibilityRole="button" disabled={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()}
                style={{ height: 44, borderRadius: 16, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.inkSoft }}>{s.loadMore}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 12 } });
