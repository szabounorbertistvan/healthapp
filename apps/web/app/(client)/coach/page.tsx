import { getMyCoachThread, hasActiveCoach } from "@/lib/client-data";
import { Card, EmptyState } from "@/components/ui";
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
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.common.nav.coach}
        </h1>
        {/* This is the only way in for a client whose account is no longer
            empty: /welcome carries the same form but today/page.tsx stops
            redirecting there once they have a program or picked solo. */}
        <Card plain className="mt-5 space-y-3 sm:mt-6">
          <p className="font-display text-lg font-bold tracking-tight">{t.clientApp.coach.noCoachTitle}</p>
          <p className="text-[13.5px] leading-relaxed text-ink-soft">{t.clientApp.welcome.withCoachBody}</p>
          <JoinCoach autoFocus={false} />
        </Card>
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.common.nav.coach}
        </h1>
        <div className="mt-5 sm:mt-6">
          <EmptyState
            plain
            title={t.clientApp.coach.noMessagesTitle}
            hint={t.clientApp.coach.noMessagesHint}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <h1 className="mb-4 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {thread.coach_name}
      </h1>
      <MessageThread conversationId={thread.id} initialMessages={thread.messages} />
    </div>
  );
}
