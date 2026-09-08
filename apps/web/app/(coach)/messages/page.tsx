import Link from "next/link";
import { getConversations } from "@/lib/data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export default async function MessagesPage() {
  const { t, locale } = await getI18n();
  const conversations = await getConversations();
  return (
    <div>
      <PageTitle title={t.common.nav.messages} />
      {conversations.length === 0 ? (
        <EmptyState title={t.coachApp.messages.emptyTitle} hint={t.coachApp.messages.emptyHint} />
      ) : (
        <div className="flex max-w-xl flex-col gap-2">
          {conversations.map((c) => (
            <Link key={c.id} href={`/messages/${c.id}`}>
              <Card className="flex items-center justify-between gap-3 transition hover:border-accent">
                <div className="min-w-0">
                  <p className="font-semibold">{c.full_name}</p>
                  <p className="truncate text-sm text-ink-soft">{c.last_message}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-ink-faint">{timeAgo(c.last_at, locale)}</p>
                  {c.unread > 0 ? (
                    <span className="mt-1 inline-block rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-fg">
                      {c.unread}
                    </span>
                  ) : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
