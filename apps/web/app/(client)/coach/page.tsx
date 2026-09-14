import { getMyCoachThread, hasActiveCoach } from "@/lib/client-data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { JoinCoach } from "@/components/join-coach";
import { MessageThread } from "@/components/message-thread";
import { getI18n } from "@/lib/i18n/server";

export default async function CoachPage() {
  const { t } = await getI18n();
  const [thread, coached] = await Promise.all([getMyCoachThread(), hasActiveCoach()]);

  // Three states, not two. getMyCoachThread() answers "is there a conversation
  // row", which is null both for a client with no coach and for one whose coach
  // has simply never messaged them — offering the join form to the second would
  // send them into accept_invite only to be told ALREADY_HAS_COACH.
  if (!coached) {
    return (
      <div className="mx-auto max-w-md">
        <PageTitle title={t.common.nav.coach} />
        {/* This is the only way in for a client whose account is no longer
            empty: /welcome carries the same form but today/page.tsx stops
            redirecting there once they have a program or picked solo. */}
        <Card className="space-y-2">
          <p className="font-bold">{t.clientApp.coach.noCoachTitle}</p>
          <p className="text-sm text-ink-soft">{t.clientApp.welcome.withCoachBody}</p>
          <JoinCoach autoFocus={false} />
        </Card>
      </div>
    );
  }

  if (!thread) {
    return (
      <div>
        <PageTitle title={t.common.nav.coach} />
        <EmptyState
          title={t.clientApp.coach.noMessagesTitle}
          hint={t.clientApp.coach.noMessagesHint}
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
