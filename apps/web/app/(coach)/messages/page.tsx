import Link from "next/link";
import { getConversations } from "@/lib/data";
import { Card, EmptyState } from "@/components/ui";
import { NavIcon } from "@/components/client-nav";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

const CHEVRON = "m9 6 6 6-6 6";

export default async function MessagesPage() {
  const { t, locale } = await getI18n();
  const conversations = await getConversations();
  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{t.common.nav.messages}</h1>
      </header>
      <div className="mt-5 sm:mt-6">
        {conversations.length === 0 ? (
          <EmptyState plain title={t.coachApp.messages.emptyTitle} hint={t.coachApp.messages.emptyHint} />
        ) : (
          <Card plain className="overflow-hidden p-0">
            <ul className="divide-y divide-line/60">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/messages/${c.id}`}
                    className="flex min-h-16 items-center gap-3.5 px-5 py-4 transition hover:bg-accent-soft/40"
                  >
                    <span
                      aria-hidden
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-[15px] font-bold ${
                        c.unread > 0 ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-ink"
                      }`}
                    >
                      {c.full_name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[15px] ${c.unread > 0 ? "font-bold" : "font-semibold"}`}>
                        {c.full_name}
                      </span>
                      <span className={`mt-0.5 block truncate text-[13px] ${c.unread > 0 ? "text-ink-soft" : "text-ink-faint"}`}>
                        {c.last_message}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-[12.5px] tabular-nums text-ink-faint">{timeAgo(c.last_at, locale)}</span>
                      {c.unread > 0 ? (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold tabular-nums text-accent-fg">
                          {c.unread}
                        </span>
                      ) : null}
                    </span>
                    <NavIcon d={CHEVRON} className="h-4 w-4 shrink-0 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
