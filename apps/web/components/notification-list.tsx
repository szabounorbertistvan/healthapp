"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNotificationRead, markNotificationsRead } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { timeAgo } from "@/lib/format";
import { Card } from "./ui";
import { Avatar } from "./social";
import { NavIcon } from "./client-nav";
import type { NotificationRow } from "@/lib/notifications-data";

/** The social categories, which get a sentence built from the actor's name. */
const SOCIAL: Record<string, keyof ReturnType<typeof useMessages>["notified"]> = {
  new_follower: "new_follower",
  new_kudos: "new_kudos",
  new_comment: "new_comment",
  comment_reply: "comment_reply",
  new_mention: "new_mention",
};

function useMessages() {
  const { t } = useI18n();
  return t.common.social;
}

/**
 * The notifications list.
 *
 * Read state is explicit: a row marks itself read when it is followed, and
 * "mark all as read" does the rest. Rendering the page does nothing — an
 * unread badge that clears itself because you looked at it is not a badge.
 */
export function NotificationList({ notifications }: { notifications: NotificationRow[] }) {
  const { t } = useI18n();
  const s = useMessages();
  const n = t.common.notifications;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic: a row dims the moment it is followed, rather than after the
  // navigation and the refresh have both landed.
  const [read, setRead] = useState<Set<string>>(new Set());

  const unread = notifications.filter((n) => !n.read && !read.has(n.id)).length;

  if (notifications.length === 0) {
    return (
      <Card plain className="mt-5 py-10 text-center">
        <p className="font-display text-lg font-bold tracking-tight">{s.noNotifications}</p>
        <p className="mt-1.5 text-[13px] text-ink-soft">{s.noNotificationsHint}</p>
      </Card>
    );
  }

  return (
    <>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-faint">
          {unread > 0 ? fill(n.unreadCount, { count: unread }) : s.allRead}
        </p>
        {unread > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setRead(new Set(notifications.map((n) => n.id)));
                await markNotificationsRead();
                router.refresh();
              })
            }
            className="inline-flex h-9 items-center rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {s.markAllRead}
          </button>
        ) : null}
      </div>

      <ul className="mt-3 space-y-2">
        {notifications.map((n) => (
          <li key={n.id}>
            <NotificationCard
              notification={n}
              read={n.read || read.has(n.id)}
              onFollow={() => {
                if (n.read || read.has(n.id)) return;
                setRead((current) => new Set(current).add(n.id));
                startTransition(async () => {
                  await markNotificationRead(n.id);
                  router.refresh();
                });
              }}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function NotificationCard({
  notification, read, onFollow,
}: {
  notification: NotificationRow;
  read: boolean;
  onFollow: () => void;
}) {
  const { t, locale } = useI18n();
  const s = t.common.social;
  const key = SOCIAL[notification.category];
  // A social row reads as a sentence about a person; an engine row (the streak
  // and check-in cron jobs) already carries its own title and body.
  const headline = key && notification.actor
    ? fill(s.notified[key], { name: notification.actor.name })
    : notification.title;

  const inner = (
    <div className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 ${read ? "bg-surface" : "bg-accent-soft/50"}`}>
      {notification.actor ? (
        <Avatar name={notification.actor.name} url={notification.actor.avatar_url} size="h-9 w-9" />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg text-ink-faint">
          <NavIcon d="M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0" className="h-[17px] w-[17px]" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug">{headline}</p>
        {notification.body ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-soft">{notification.body}</p>
        ) : null}
        <p className="mt-1 text-[11.5px] text-ink-faint">{timeAgo(notification.created_at, locale)}</p>
      </div>
      {!read ? (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={s.unread} />
      ) : null}
    </div>
  );

  return notification.href ? (
    <Link href={notification.href} onClick={onFollow} className="block transition hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}
