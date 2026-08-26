import { getMyCoachThread } from "@/lib/client-data";
import { EmptyState, PageTitle } from "@/components/ui";
import { MessageThread } from "@/components/message-thread";

export default async function CoachPage() {
  const thread = await getMyCoachThread();

  if (!thread) {
    return (
      <div>
        <PageTitle title="Coach" />
        <EmptyState
          title="No coach yet"
          hint="Once you accept a coach invite, your conversation appears here."
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
