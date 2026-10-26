import type { MessageV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { shareFile } from "@/lib/share-file";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { supabase } from "@/lib/supabase";
import { font, useTheme } from "@/lib/theme";

// One conversation, from either side — the client's thread with their coach
// and every thread on the coach's Chats tab. GET /api/v1/threads/[id] is the
// web's getConversationContext + getMessages; new messages arrive through
// Supabase Realtime (msg_select applies to every change it delivers,
// 20261207130000) and the thread is then re-read, so nothing is shown that a
// read would not show. Sending needs a connection: a message is a
// conversation, not a log, and an hour-late "on my way" is worse than none.
export function ThreadView({ conversationId, back, header }: {
  conversationId: string; back: string;
  /** Above the messages, scrolling with them (the client's Coach page: the coaching card). */
  header?: ReactNode;
}) {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const key = ["thread", conversationId];
  const query = useOfflineQuery(`thread:${conversationId}`, key, () => api.thread(conversationId));
  const thread = query.data?.data;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<MessageV1>>(null);

  // On screen = read; and live while it is.
  useEffect(() => {
    void api.markThreadRead(conversationId).catch(() => {});
    const channel = supabase
      .channel(`thread:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["thread", conversationId] });
          void api.markThreadRead(conversationId).catch(() => {});
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  async function send() {
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.sendMessage(conversationId, draft.trim());
      if (!result.ok) {
        setError(result.errorCode === "CONVERSATION_CLOSED" ? t.mobile.messages.closed : result.message ?? t.mobile.messages.couldNotSend);
        return;
      }
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["thread", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["coach-conversations"] });
    } catch (e) {
      setError(e instanceof ApiFailure && e.kind === "offline" ? t.mobile.messages.couldNotSend : t.mobile.errors.generic);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.header}>
            <BackHeader label={back} />
            <T kind="title" numberOfLines={1}>{thread?.other_name ?? t.mobile.messages.title}</T>
            {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}
          </View>
          {!thread ? (
            query.isError ? <T kind="soft" style={styles.pad}>{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : (
            <>
              <FlatList
                ref={list}
                data={thread.messages}
                keyExtractor={(m) => m.id}
                contentContainerStyle={styles.list}
                onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
                ListHeaderComponent={header ? <View style={{ marginBottom: 6 }}>{header}</View> : undefined}
                ListEmptyComponent={<T kind="faint">{t.mobile.messages.empty}</T>}
                renderItem={({ item }) => <Bubble m={item} />}
              />
              {error ? <T style={{ ...styles.pad, color: color.risk }}>{error}</T> : null}
              {thread.open ? (
                <View style={[styles.composer, { borderTopColor: color.line }]}>
                  <TextInput
                    accessibilityLabel={t.mobile.messages.placeholder}
                    placeholder={t.mobile.messages.placeholder}
                    placeholderTextColor={color.inkFaint}
                    value={draft}
                    onChangeText={setDraft}
                    multiline
                    maxLength={4000}
                    style={[styles.input, { color: color.ink, backgroundColor: color.surface, borderColor: color.line }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.mobile.messages.send}
                    disabled={sending || !draft.trim()}
                    onPress={() => void send()}
                    style={[styles.send, { backgroundColor: color.accent, opacity: sending || !draft.trim() ? 0.5 : 1 }]}
                  >
                    {sending ? (
                      <ActivityIndicator color={color.accentFg} />
                    ) : (
                      <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: color.accentFg }}>{t.mobile.messages.send}</Text>
                    )}
                  </Pressable>
                </View>
              ) : (
                <View style={[styles.closed, { backgroundColor: color.surface }]}>
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: color.inkSoft }}>{t.mobile.coach.closedThread}</Text>
                </View>
              )}
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

/** One message (message-thread.tsx): mine on the soft gold, theirs on the surface, 80 % wide at most. */
function Bubble({ m }: { m: MessageV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const [picture, setPicture] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const label = m.attachment === "image" ? t.mobile.messages.photo : m.attachment === "audio" ? t.mobile.messages.voice : null;

  // The file is fetched only when tapped (message-thread.tsx Attachment): a
  // picture shows in the bubble, a voice note goes to the phone's player.
  async function open() {
    if (loading || picture) return;
    setLoading(true);
    try {
      const { bytes, type } = await api.messageAttachment(m.id);
      if (m.attachment === "image") setPicture(`data:${type};base64,${toBase64(bytes)}`);
      else await shareFile(`voice-note.${type.split("/")[1]?.split(";")[0] ?? "m4a"}`, bytes, type);
    } catch {
      // a failed fetch leaves the placeholder; another tap tries again
    } finally {
      setLoading(false);
    }
  }

  return (
    <Pressable
      disabled={!m.attachment}
      onPress={() => void open()}
      style={[styles.bubble, { alignSelf: m.mine ? "flex-end" : "flex-start", backgroundColor: m.mine ? color.accentSoft : color.surface }]}
    >
      {picture ? (
        <Image source={{ uri: picture }} accessibilityLabel={t.coachWidgets.messageThread.photo} resizeMode="cover" style={{ width: 220, height: 220, borderRadius: 12 }} />
      ) : label ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {loading ? <ActivityIndicator size="small" color={color.inkSoft} /> : null}
          <Text style={[styles.text, { color: color.inkSoft, fontStyle: "italic" }]}>{label}</Text>
        </View>
      ) : null}
      {m.body ? <Text style={[styles.text, { color: color.ink }, label ? { marginTop: 6 } : null]}>{m.body}</Text> : null}
    </Pressable>
  );
}

/** Bytes → base64, for a picture shown from memory (btoa takes a binary string). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 12, gap: 2 },
  pad: { paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  bubble: { maxWidth: "80%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  text: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 21 },
  composer: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, alignItems: "flex-end" },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11, fontFamily: font.regular, fontSize: 14 },
  send: { height: 44, borderRadius: 16, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  closed: { marginHorizontal: 16, marginTop: 12, marginBottom: 16, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
});
