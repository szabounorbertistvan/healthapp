import Link from "next/link";
import { getConversations, getMessages } from "@/lib/data";
import { PageTitle } from "@/components/ui";
import { MessageThread } from "@/components/message-thread";
import { getI18n } from "@/lib/i18n/server";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const [conversations, messages] = await Promise.all([getConversations(), getMessages(id)]);
  const conversation = conversations.find((c) => c.id === id);

  return (
    <div className="flex h-full max-w-2xl flex-col">
      <Link href="/messages" className="text-sm text-accent-ink hover:underline">{t.coachApp.messages.back}</Link>
      <PageTitle title={conversation?.full_name ?? t.coachApp.messages.conversation} />
      <MessageThread conversationId={id} initialMessages={messages} />
    </div>
  );
}
