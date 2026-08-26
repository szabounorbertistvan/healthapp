import { getMyCoachThread } from "@/lib/client-data";
import { EmptyState, PageTitle } from "@/components/ui";
import { MessageThread } from "@/components/message-thread";
import { getI18n } from "@/lib/i18n/server";

export default async function CoachPage() {
  const { t } = await getI18n();
  const thread = await getMyCoachThread();

  if (!thread) {
    return (
      <div>
        <PageTitle title={t.common.nav.coach} />
        <EmptyState
          title={t.clientApp.coach.noCoachTitle}
          hint={t.clientApp.coach.noCoachHint}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full max-w-2xl flex-col">
      <PageTitle title={thread.coach_name} />
      <MessageThread conversationId={thread.id} initialMessages={thread.messages} />
    </div>
  );
}
