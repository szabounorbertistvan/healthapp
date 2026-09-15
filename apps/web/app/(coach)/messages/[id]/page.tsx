import Link from "next/link";
import { getConversations, getMessages } from "@/lib/data";
import { MessageThread } from "@/components/message-thread";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const [conversations, messages] = await Promise.all([getConversations(), getMessages(id)]);
  const conversation = conversations.find((c) => c.id === id);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <Link
        href="/messages"
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {t.coachApp.messages.back}
      </Link>
      <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">
        {conversation?.full_name ?? t.coachApp.messages.conversation}
      </h1>
      <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-5">
        <MessageThread conversationId={id} initialMessages={messages} />
      </div>
    </div>
  );
}
