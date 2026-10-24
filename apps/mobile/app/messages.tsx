import { ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThreadView } from "@/components/thread-view";
import { Screen, T } from "@/components/ui";
import { BackHeader } from "@/components/workout-bits";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useOfflineQuery } from "@/lib/offline-query";
import { space, useTheme } from "@/lib/theme";

// The client's thread with their current coach — the web's /coach. Which
// conversation that is comes from GET /api/v1/coach-thread; the thread itself
// is the shared ThreadView (the same one the coach's Chats tab opens).
export default function Messages() {
  const { t } = useI18n();
  const { color } = useTheme();
  const query = useOfflineQuery("coach-thread", ["coach-thread"], api.coachThread);
  const thread = query.data?.data;

  if (thread?.conversation_id) return <ThreadView conversationId={thread.conversation_id} back={t.mobile.tabs.more} />;
  return (
    <Screen>
      <SafeAreaView style={styles.body}>
        <BackHeader label={t.mobile.tabs.more} />
        <T kind="title">{t.mobile.messages.title}</T>
        {thread ? (
          <T kind="soft">{t.mobile.messages.noCoach}</T>
        ) : query.isError ? (
          <T kind="soft">{t.mobile.errors.offline}</T>
        ) : (
          <ActivityIndicator color={color.accent} />
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, padding: space.lg, gap: space.md } });
