import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PostCard } from "@/components/post-card";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { font, useTheme } from "@/lib/theme";

// The home feed — the web's /feed on a phone: Following · All · My activity,
// the composer, then one card per post (components/post-card.tsx), paged on the
// same cursor. A card's comments open the post's page (app/post/[id].tsx).

type Scope = "following" | "all" | "mine";

export default function Feed() {
  const { t } = useI18n();
  const { color } = useTheme();
  const s = t.common.social;
  const [scope, setScope] = useState<Scope>("following");
  const query = useInfiniteQuery({
    queryKey: ["feed", scope],
    queryFn: ({ pageParam }) => api.feed(scope, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const tabs: { key: Scope; label: string }[] = [
    { key: "following", label: s.feedFollowing },
    { key: "all", label: s.feedAll },
    { key: "mine", label: s.feedMine },
  ];
  const empty =
    scope === "mine" ? { title: s.emptyMineTitle, hint: s.emptyMineHint }
    : scope === "all" ? { title: s.emptyAllTitle, hint: s.emptyAllHint }
    : { title: s.emptyFollowingTitle, hint: s.emptyFollowingHint };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.common.nav.more} />
        <Text style={{ fontFamily: font.displayExtrabold, fontSize: 22, color: color.ink }}>{s.feed}</Text>

        <View style={[styles.tabs, { backgroundColor: color.surface, borderColor: color.line }]}>
          {tabs.map((tab) => {
            const on = tab.key === scope;
            return (
              <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setScope(tab.key)} style={[styles.tab, on ? { backgroundColor: color.accent } : null]}>
                <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 13, color: on ? color.accentFg : color.inkSoft }}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Composer />

        {query.isLoading ? (
          <ActivityIndicator color={color.accent} style={{ marginTop: 32 }} />
        ) : query.isError ? (
          <T kind="soft">{t.mobile.errors.offline}</T>
        ) : items.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: color.surface, borderColor: color.line }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, color: color.ink, textAlign: "center" }}>{empty.title}</Text>
            <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.inkSoft, textAlign: "center" }}>{empty.hint}</Text>
          </View>
        ) : (
          items.map((p) => <PostCard key={p.id} post={p} />)
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

type Visibility = "public" | "followers" | "private";

/** A text post (social.tsx Composer, words only): 1–500 characters and who may see it. */
function Composer() {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.common.social;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = text.trim().length >= 1 && text.trim().length <= 500;

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createPost(text, visibility);
      if (!r.ok) return setError(r.message ?? s.textInvalid);
      setText("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : s.textInvalid);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.prompt, { backgroundColor: color.surface, borderColor: color.line }]}>
        <Text style={{ fontFamily: font.regular, fontSize: 14, color: color.inkFaint }}>{s.composerPlaceholder}</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.composer, { backgroundColor: color.surface, borderColor: color.line }]}>
      <TextInput
        autoFocus
        multiline
        maxLength={500}
        value={text}
        onChangeText={setText}
        placeholder={s.composerPlaceholder}
        placeholderTextColor={color.inkFaint}
        accessibilityLabel={s.composerPlaceholder}
        style={{ minHeight: 88, textAlignVertical: "top", fontFamily: font.regular, fontSize: 14.5, lineHeight: 21, color: color.ink }}
      />
      <Text style={{ marginTop: 10, fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{s.visibilityLabel}</Text>
      <View style={{ marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(["public", "followers", "private"] as const).map((v) => {
          const on = v === visibility;
          return (
            <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setVisibility(v)} style={[styles.chip, { backgroundColor: on ? color.accent : color.bg }]}>
              <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: on ? color.accentFg : color.inkSoft }}>{s.visibility[v]}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable accessibilityRole="button" disabled={busy || !valid} onPress={() => void post()} style={[styles.post, { backgroundColor: color.accent, opacity: busy || !valid ? 0.5 : 1 }]}>
          {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{s.post}</Text>}
        </Pressable>
        <Text accessibilityRole="button" onPress={() => { setOpen(false); setText(""); }} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
        <Text style={{ marginLeft: "auto", fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`${text.length}/500`}</Text>
      </View>
      {error ? <Text style={{ marginTop: 8, fontFamily: font.semibold, fontSize: 12.5, color: color.risk }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  tabs: { flexDirection: "row", gap: 4, borderRadius: 999, borderWidth: 1, padding: 4 },
  tab: { flex: 1, height: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  prompt: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14 },
  composer: { borderRadius: 20, borderWidth: 1, padding: 16 },
  chip: { height: 34, borderRadius: 17, paddingHorizontal: 14, justifyContent: "center" },
  post: { height: 42, minWidth: 96, borderRadius: 16, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  empty: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 40 },
  more: { height: 44, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
