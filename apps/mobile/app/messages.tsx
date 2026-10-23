import type { MessageV1 } from "@healthapp/api/v1";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api, ApiFailure } from "@/lib/api";
import { config } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { supabase } from "@/lib/supabase";
import { fontSize, minTouchTarget, radius, space, useTheme } from "@/lib/theme";

// The thread with the current coach — the web's /coach. New messages arrive
// through Supabase Realtime (msg_select applies to every change it delivers,
// 20261207130000); the thread is then re-read from the server, so nothing is
// shown that a read would not show. Sending needs a connection: a message is
// a conversation, not a log, and an hour-late "on my way" is worse than none.
export default function Messages() {
  const { t } = useI18n();
  const { color } = useTheme();
  const queryClient = useQueryClient();
  const query = useOfflineQuery("coach-thread", ["coach-thread"], api.coachThread);
  const thread = query.data?.data;
  const conversationId = thread?.conversation_id ?? null;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<MessageV1>>(null);

  // On screen = read; and live while it is.
  useEffect(() => {
    if (!conversationId) return;
    void api.markThreadRead(conversationId).catch(() => {});
    const channel = supabase
      .channel(`thread:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["coach-thread"] });
          void api.markThreadRead(conversationId).catch(() => {});
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  const messages = thread && thread.conversation_id ? thread.messages : [];

  async function send() {
    if (!conversationId || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.sendMessage(conversationId, draft.trim());
      if (!result.ok) {
        setError(result.errorCode === "CONVERSATION_CLOSED" ? t.mobile.messages.closed : result.message ?? t.mobile.messages.couldNotSend);
        return;
      }
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["coach-thread"] });
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
            <BackHeader label={t.mobile.tabs.more} />
            <T kind="title">{thread && thread.conversation_id ? thread.coach_name : t.mobile.messages.title}</T>
            {query.data?.fromPhone ? <T kind="faint">{t.mobile.workout.fromPhone}</T> : null}
          </View>
          {!thread ? (
            query.isError ? <T kind="soft" style={styles.pad}>{t.mobile.errors.offline}</T> : <ActivityIndicator color={color.accent} />
          ) : !thread.conversation_id ? (
            <T kind="soft" style={styles.pad}>{t.mobile.messages.noCoach}</T>
          ) : (
            <>
              <FlatList
                ref={list}
                data={messages}
                keyExtractor={(m) => m.id}
                contentContainerStyle={styles.list}
                onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
                ListEmptyComponent={<T kind="faint">{t.mobile.messages.empty}</T>}
                renderItem={({ item }) => <Bubble m={item} />}
              />
              {error ? <T style={{ ...styles.pad, color: color.risk }}>{error}</T> : null}
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
                  {sending ? <ActivityIndicator color={color.accentFg} /> : <T style={{ color: color.accentFg, fontWeight: "700" }}>{t.mobile.messages.send}</T>}
                </Pressable>
              </View>
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

function Bubble({ m }: { m: MessageV1 }) {
  const { t } = useI18n();
  const { color } = useTheme();
  const text = m.attachment === "image" ? t.mobile.messages.photo : m.attachment === "audio" ? t.mobile.messages.voice : m.body;
  const time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <Pressable
      disabled={!m.attachment}
      onPress={() => Linking.openURL(`${config.webUrl}/coach`)}
      style={[
        styles.bubble,
        m.mine
          ? { alignSelf: "flex-end", backgroundColor: color.accent }
          : { alignSelf: "flex-start", backgroundColor: color.surface, borderColor: color.line, borderWidth: 1 },
      ]}
    >
      <T style={{ color: m.mine ? color.accentFg : color.ink, fontStyle: m.attachment ? "italic" : "normal" }}>{text}</T>
      {m.attachment && m.body ? <T style={{ color: m.mine ? color.accentFg : color.ink }}>{m.body}</T> : null}
      <T style={{ fontSize: fontSize.xs, color: m.mine ? color.accentFg : color.inkFaint, alignSelf: "flex-end" }}>{time}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: 2 },
  pad: { paddingHorizontal: space.lg },
  list: { padding: space.lg, gap: space.sm },
  bubble: { maxWidth: "82%", borderRadius: radius.xl, paddingHorizontal: space.md, paddingVertical: space.sm, gap: 2 },
  composer: { flexDirection: "row", gap: space.sm, padding: space.md, borderTopWidth: 1, alignItems: "flex-end" },
  input: { flex: 1, minHeight: minTouchTarget + 4, maxHeight: 140, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: fontSize.base },
  send: { minHeight: minTouchTarget + 4, borderRadius: radius.lg, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
});
