import { useLocalSearchParams } from "expo-router";
import { ThreadView } from "@/components/thread-view";
import { useI18n } from "@/lib/i18n";

// A conversation opened from the coach's Chats tab (or a notification).
export default function Thread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  return <ThreadView conversationId={id} back={t.mobile.coach.chats} />;
}
