import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getConversationContext, getMessages } from "@/lib/data";
import { MessageThread, ThreadHeader } from "@/components/message-thread";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [context, messages] = await Promise.all([getConversationContext(id), getMessages(id)]);
  if (!context) notFound();
  // A coach who trains with a coach of their own reads that thread as the client.
  if (context.side === "client") redirect(`/coach/messages/${id}`);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <Link
        href="/messages"
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {t.coachApp.messages.back}
      </Link>
      <div className="mt-4">
        <ThreadHeader context={context} expanded={messages.length === 0} />
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-5">
        <MessageThread conversationId={id} initialMessages={messages} closed={!context.open} />
      </div>
    </div>
  );
}
