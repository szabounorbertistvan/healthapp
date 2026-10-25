import type { CommentV1, PostDetailV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PostCard, useWhen } from "@/components/post-card";
import { T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { alpha, font, useTheme } from "@/lib/theme";

// One post's page — the web's /feed/[postId] on a phone: the post, its comments
// with their replies one level under, a reply to any comment, deleting your own
// comment or post, and the box to comment at the bottom.

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const s = t.common.social;
  const query = useOfflineQuery(`post:${id}`, ["post", id], () => api.post(id));
  const data = query.data?.data;
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["post", id] });
    void queryClient.invalidateQueries({ queryKey: ["feed"] });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addComment(id, body, replyTo?.id ?? null);
      if (!r.ok) return setError(r.message ?? s.commentInvalid);
      setBody("");
      setReplyTo(null);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.errors.offline : s.commentInvalid);
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(c: CommentV1) {
    try {
      const r = await api.deleteComment(c.id, id);
      if (!r.ok) return setError(r.message ?? t.mobile.errors.generic);
      await refresh();
    } catch {
      setError(t.mobile.errors.generic);
    }
  }

  async function removePost() {
    try {
      const r = await api.deletePost(id);
      if (!r.ok) return setError(r.message ?? t.mobile.errors.generic);
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      router.back();
    } catch {
      setError(t.mobile.errors.generic);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BackHeader label={s.feed} />
          {!data ? (
            query.isError ? <T kind="soft">{s.notFound}</T> : <ActivityIndicator color={color.accent} style={{ marginTop: 48 }} />
          ) : (
            <>
              <PostCard post={data.post} link={false} />
              {data.post.mine ? (
                confirmDelete ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Pressable accessibilityRole="button" onPress={() => void removePost()} style={[styles.pill, { backgroundColor: color.risk }]}>
                      <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: color.bg }}>{t.common.actions.delete}</Text>
                    </Pressable>
                    <Text accessibilityRole="button" onPress={() => setConfirmDelete(false)} style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.cancel}</Text>
                  </View>
                ) : (
                  <Text accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={{ alignSelf: "flex-start", fontFamily: font.semibold, fontSize: 12.5, color: color.inkFaint }}>{t.common.actions.delete}</Text>
                )
              ) : null}

              <Text style={styles.label(color.inkFaint)}>{s.comments}</Text>
              {data.comments.items.length === 0 ? (
                <T kind="faint">{s.noComments}</T>
              ) : (
                <View style={{ gap: 14 }}>
                  {data.comments.items.map((c) => (
                    <View key={c.id} style={{ gap: 10 }}>
                      <CommentRow c={c} onReply={() => setReplyTo(c)} onDelete={() => void removeComment(c)} />
                      {c.replies.map((r) => (
                        <View key={r.id} style={{ marginLeft: 44 }}>
                          <CommentRow c={r} onDelete={() => void removeComment(r)} />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}
              <LoadOlder data={data} postId={id} />
            </>
          )}
        </ScrollView>

        {data ? (
          <View style={[styles.composer, { borderTopColor: color.line, backgroundColor: alpha(color.bg, 0.92) }]}>
            {replyTo ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.regular, fontSize: 12, color: color.inkFaint }}>{`${s.replyingTo} ${replyTo.author_name}`}</Text>
                <Text accessibilityRole="button" onPress={() => setReplyTo(null)} style={{ fontFamily: font.semibold, fontSize: 12, color: color.inkSoft }}>{s.cancelReply}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <TextInput
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={500}
                placeholder={replyTo ? s.writeReply : s.writeComment}
                placeholderTextColor={color.inkFaint}
                accessibilityLabel={replyTo ? s.writeReply : s.writeComment}
                style={[styles.input, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={busy || !body.trim()}
                onPress={() => void send()}
                style={[styles.send, { backgroundColor: color.accent, opacity: busy || !body.trim() ? 0.5 : 1 }]}
              >
                {busy ? <ActivityIndicator color={color.accentFg} /> : <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{s.send}</Text>}
              </Pressable>
            </View>
            {error ? <Text style={{ marginTop: 6, fontFamily: font.semibold, fontSize: 12, color: color.risk }}>{error}</Text> : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CommentRow({ c, onReply, onDelete }: { c: CommentV1; onReply?: () => void; onDelete?: () => void }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const when = useWhen();
  const s = t.common.social;
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {c.author_avatar ? (
        <Image source={{ uri: c.author_avatar }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, { backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }]}>
          <Text style={{ fontFamily: font.displayBold, fontSize: 13, color: color.accentInk }}>{[...c.author_name.trim()][0]?.toUpperCase() ?? "?"}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={[styles.bubble, { backgroundColor: color.surface }]}>
          <Text style={{ fontFamily: font.semibold, fontSize: 13, color: color.ink }}>{c.author_name}</Text>
          <Text style={{ marginTop: 2, fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: color.ink }}>{c.body}</Text>
        </View>
        <View style={{ marginTop: 4, flexDirection: "row", gap: 14, paddingHorizontal: 4 }}>
          <Text style={{ fontFamily: font.regular, fontSize: 11.5, color: color.inkFaint }}>{when(c.created_at)}</Text>
          {onReply ? <Text accessibilityRole="button" onPress={onReply} style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkSoft }}>{s.reply}</Text> : null}
          {c.mine && onDelete ? <Text accessibilityRole="button" onPress={onDelete} style={{ fontFamily: font.semibold, fontSize: 11.5, color: color.inkFaint }}>{s.deleteComment}</Text> : null}
        </View>
      </View>
    </View>
  );
}

/** Older comments, a page at a time (the same before-cursor as the web). */
function LoadOlder({ data, postId }: { data: PostDetailV1; postId: string }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const [extra, setExtra] = useState<PostDetailV1["comments"]["items"]>([]);
  const [cursor, setCursor] = useState(data.comments.next_cursor);
  const [busy, setBusy] = useState(false);
  if (!cursor) return null;
  return (
    <View style={{ gap: 14 }}>
      {extra.map((c) => (
        <View key={c.id} style={{ gap: 10 }}>
          <CommentRow c={c} />
          {c.replies.map((r) => (
            <View key={r.id} style={{ marginLeft: 44 }}>
              <CommentRow c={r} />
            </View>
          ))}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const next = await api.post(postId, cursor);
            setExtra((x) => [...x, ...next.comments.items]);
            setCursor(next.comments.next_cursor);
          } finally {
            setBusy(false);
          }
        }}
        style={{ alignSelf: "flex-start", opacity: busy ? 0.5 : 1 }}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.accentInk }}>{t.common.social.loadMoreComments}</Text>
      </Pressable>
    </View>
  );
}

const styles = {
  ...StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 14 },
    pill: { height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: "center" },
    avatar: { width: 34, height: 34, borderRadius: 17 },
    bubble: { alignSelf: "flex-start", maxWidth: "100%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
    composer: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
    input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, fontFamily: font.regular, fontSize: 14 },
    send: { height: 44, borderRadius: 16, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  }),
  label: (ink: string) => ({ fontFamily: font.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" as const, color: ink }),
};
