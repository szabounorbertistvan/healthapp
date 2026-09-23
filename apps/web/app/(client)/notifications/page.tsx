import Link from "next/link";
import { getNotificationPage, getUnreadNotificationCount } from "@/lib/notifications-data";
import { NotificationList } from "@/components/notification-list";
import { getI18n } from "@/lib/i18n/server";

/**
 * The notifications center: every notification, newest first, paged on a
 * cursor, with who did it — follows, kudos, comments, replies, mentions,
 * badges, and the engine's streak and check-in reminders.
 *
 * The bell is a glance; this is the list. Opening it marks nothing read — that
 * happens when one is followed, or when "mark all as read" is pressed.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { t } = await getI18n();
  const { filter } = await searchParams;
  const unreadOnly = filter === "unread";
  const [page, unread] = await Promise.all([
    getNotificationPage({ unreadOnly }),
    getUnreadNotificationCount(),
  ]);
  const n = t.common.notifications;

  const tab = (key: "all" | "unread", label: string) => {
    const active = (key === "unread") === unreadOnly;
    return (
      <Link
        href={key === "unread" ? "/notifications?filter=unread" : "/notifications"}
        aria-current={active ? "page" : undefined}
        className={`inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold ${
          active ? "bg-accent text-accent-fg" : "bg-surface text-ink-soft hover:text-ink"
        }`}
      >
        {label}
        {key === "unread" && unread > 0 ? <span className="ml-1.5 tabular-nums">{unread}</span> : null}
      </Link>
    );
  };

  return (
    <div className="mx-auto max-w-[680px]">
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">
        {t.common.social.notifications}
      </h1>
      <nav className="mt-4 flex gap-1.5" aria-label={t.common.social.notifications}>
        {tab("all", n.filterAll)}
        {tab("unread", n.filterUnread)}
      </nav>
      {/* Keyed on the filter so switching tabs starts a fresh list and cursor. */}
      <NotificationList key={unreadOnly ? "unread" : "all"} page={page} unread={unread} unreadOnly={unreadOnly} />
    </div>
  );
}
