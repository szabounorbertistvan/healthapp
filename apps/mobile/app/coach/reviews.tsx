import type { CoachReviewsV1 } from "@healthapp/api/v1";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Linking, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/role";
import { font, useTheme } from "@/lib/theme";

// What clients say about the coach — the web's /reviews on a phone
// (components/coach-reviews.tsx): the rating as the public sees it with its
// stars, then each review with the coach's one answer (write, edit, remove).
// A review is the client's: the coach never edits or deletes it.

type Item = NonNullable<CoachReviewsV1>["items"][number];

export default function CoachReviews() {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const r = t.coachProfile.reviews;
  const c = r.coach;
  const query = useQuery({ queryKey: ["coach-reviews"], queryFn: api.coachReviews });
  const d = query.data;
  const avg = d?.average != null ? new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(d.average) : null;
  const total = d ? d.distribution.reduce((a, b) => a + b, 0) : 0;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.accent} />}
      >
        <BackHeader label={t.marketplace.title} />
        <View>
          <T kind="title">{c.title}</T>
          <Text style={{ marginTop: 6, fontFamily: font.regular, fontSize: 13.5, lineHeight: 19, color: color.inkSoft }}>{c.hint}</Text>
        </View>
        {query.isLoading ? <ActivityIndicator color={color.accent} /> : query.isError ? <T kind="soft">{t.mobile.errors.offline}</T> : !d ? (
          <T kind="faint">{t.coachProfile.bookings.availability.noProfile}</T>
        ) : (
          <>
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10 }}>
                <Text style={{ fontFamily: font.displayExtrabold, fontSize: 34, color: color.ink }}>{avg ?? "—"}</Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkFaint }}>{`${r.outOf} · ${d.count} ${d.count === 1 ? r.one : r.many}`}</Text>
              </View>
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = d.distribution[stars - 1] ?? 0;
                return (
                  <View key={stars} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ width: 28, fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{`${stars}★`}</Text>
                    <View style={[styles.track, { backgroundColor: color.bg }]}>
                      <View style={{ width: `${total ? Math.round((n / total) * 100) : 0}%`, height: "100%", borderRadius: 4, backgroundColor: color.accent }} />
                    </View>
                    <Text style={{ width: 24, textAlign: "right", fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{n}</Text>
                  </View>
                );
              })}
              <Text accessibilityRole="link" onPress={() => router.push({ pathname: "/coaches/[slug]", params: { slug: d.slug } })} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{`${c.viewPublic} ↗`}</Text>
            </Card>
            {d.items.length === 0 ? (
              <Card style={{ gap: 4 }}>
                <Text style={{ fontFamily: font.displayBold, fontSize: 16, color: color.ink }}>{c.empty}</Text>
                <T kind="soft">{c.emptyHint}</T>
              </Card>
            ) : d.items.map((item) => <ReviewCard key={item.id} item={item} />)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReviewCard({ item }: { item: Item }) {
  const { t, fill, locale } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const me = useMe().data?.data;
  const r = t.coachProfile.reviews;
  const c = r.coach;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.coach_response ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = new Date(item.created_at).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  async function answer(body: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.respondReview(item.id, body);
      if (!res.ok) {
        const code = res.errorCode as keyof typeof r.errors | undefined;
        return setError((code && code in r.errors ? r.errors[code] : null) ?? res.message ?? t.mobile.errors.generic);
      }
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["coach-reviews"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : t.mobile.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {item.reviewer_avatar ? <Image source={{ uri: item.reviewer_avatar }} style={styles.avatar} /> : (
          <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentInk }}>{[...item.reviewer_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 14, color: color.ink }}>{item.reviewer_name}</Text>
          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{`${r.basis[item.basis]} · ${date}${item.edited_at ? ` · ${r.edited}` : ""}`}</Text>
        </View>
        <Text accessibilityLabel={fill(r.starsLabel, { n: item.rating })} style={{ fontFamily: font.semibold, fontSize: 14, color: color.accentInk }}>{"★".repeat(item.rating)}</Text>
      </View>
      {item.status === "hidden" ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.warn }}>{c.hidden}</Text> : null}
      {item.body ? <Text style={{ fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.ink }}>{item.body}</Text> : null}
      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput autoFocus value={text} onChangeText={setText} multiline maxLength={1000} placeholder={c.answerPlaceholder} placeholderTextColor={color.inkFaint} accessibilityLabel={c.answer} style={[styles.input, { color: color.ink, backgroundColor: color.bg, borderColor: color.line }]} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Button height={38} label={c.save} busy={busy} disabled={!text.trim()} onPress={() => void answer(text.trim())} />
            <Text accessibilityRole="button" onPress={() => setEditing(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{c.cancel}</Text>
          </View>
        </View>
      ) : item.coach_response ? (
        <View style={[styles.answer, { backgroundColor: color.bg }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{fill(r.response, { name: me?.display_name ?? "" })}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.ink }}>{item.coach_response}</Text>
          <View style={{ flexDirection: "row", gap: 14, marginTop: 6 }}>
            <Text accessibilityRole="button" onPress={() => { setText(item.coach_response ?? ""); setEditing(true); }} style={{ fontFamily: font.semibold, fontSize: 12, color: color.accentInk }}>{c.editAnswer}</Text>
            <Text accessibilityRole="button" onPress={busy ? undefined : () => void answer("")} style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkFaint }}>{c.remove}</Text>
          </View>
        </View>
      ) : (
        <Text accessibilityRole="button" onPress={() => { setText(""); setEditing(true); }} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{c.answer}</Text>
      )}
      {error ? <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.risk }}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48, gap: 14 },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  input: { minHeight: 80, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: "top", fontFamily: font.regular, fontSize: 13.5 },
  answer: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});
