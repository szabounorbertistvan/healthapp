import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getConversationContext, getMessages } from "@/lib/data";
import { MessageThread, ThreadHeader } from "@/components/message-thread";
import { NavIcon } from "@/components/client-nav";
import { getI18n } from "@/lib/i18n/server";

const BACK = "m15 6-6 6 6 6";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /coach/messages/[id] — one conversation on the client's side
 * (20261104100000). /coach shows the active coach's thread; this route is
 * every other one a client can be in: a coach who accepted their request
 * ("Message coach"), or an earlier coach's history. Same thread component
 * and same RLS as the coach's /messages/[id].
 */
export default async function ClientThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [context, messages] = await Promise.all([getConversationContext(id), getMessages(id)]);
  if (!context) notFound();
  if (context.side === "coach") redirect(`/messages/${id}`);
  const back = context.relationship === "active"
    ? { href: "/coach", label: t.common.nav.coach }
    : { href: "/coaches/requests", label: t.coachProfile.requests.mine.title };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <Link
        href={back.href}
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-surface pl-3 pr-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink"
      >
        <NavIcon d={BACK} className="h-4 w-4 [stroke-width:2.2]" />
        {back.label}
      </Link>
      <div className="mt-4">
        <ThreadHeader context={context} expanded={messages.length === 0} />
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col sm:mt-5">
        <MessageThread
          conversationId={id}
          initialMessages={messages}
          closed={!context.open}
          firstMessageHint={context.relationship === "request"}
        />
      </div>
    </div>
  );
}
