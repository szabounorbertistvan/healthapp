"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadNotifications, markNotificationRead, markNotificationsRead } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { timeAgo } from "@/lib/format";
import { Card } from "./ui";
import { Avatar } from "./social";
import { NavIcon } from "./client-nav";
import type { NotificationPage, NotificationRow } from "@/lib/notifications-data";

const BELL = "M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";

/**
 * The line a notification reads as: a sentence about a person for the social
 * categories, the achievement's name for a badge, and the engine's own title
 * otherwise. Shared by this list and the bell so the two never disagree.
 */
export function useNotificationHeadline() {
  const { t, locale } = useI18n();
  const s = t.common.social;
  return (n: NotificationRow): string => {
    if (n.sentence === "badge_earned") {
      const name = n.badge ? (locale === "ro" ? n.badge.ro : n.badge.en) : n.body ?? "";
      return fill(s.notified.badge_earned, { name });
    }
    if ((n.sentence === "challenge_milestone" || n.sentence === "challenge_completed") && n.challenge) {
      const name = locale === "ro" ? n.challenge.ro : n.challenge.en;
      return fill(s.notified[n.sentence], { name, pct: n.challenge.milestone });
    }
    if (n.sentence && n.actor) return fill(s.notified[n.sentence], { name: n.actor.name });
    return n.title;
  };
}

/**
 * The notifications center list.
 *
 * Read state is explicit: a row marks itself read when it is followed, and
 * "mark all as read" does the rest. Rendering the page does nothing — an
 * unread badge that clears itself because you looked at it is not a badge.
 * Older rows page in on a created_at cursor.
 */
export function NotificationList({
  page, unread: unreadTotal, unreadOnly,
}: {
  page: NotificationPage;
  unread: number;
  unreadOnly: boolean;
}) {
  const { t } = useI18n();
  const s = t.common.social;
  const n = t.common.notifications;
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>(page.items);
  const [cursor, setCursor] = useState<string | null>(page.next_cursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  // Optimistic: a row dims the moment it is followed, rather than after the
  // navigation and the refresh have both landed.
  const [read, setRead] = useState<Set<string>>(new Set());
  const [allRead, setAllRead] = useState(false);

  // A refresh (after marking read) brings a new first page down.
  // The optimistic marks are reset with it: the server's read_at is the truth now.
  useEffect(() => {
    setItems(page.items);
    setCursor(page.next_cursor);
    setRead(new Set());
    setAllRead(false);
  }, [page]);

  const isRead = (row: NotificationRow) => allRead || row.read || read.has(row.id);
  const unread = allRead ? 0 : Math.max(0, unreadTotal - read.size);

  if (items.length === 0) {
    return (
      <Card plain className="mt-5 py-10 text-center">
        <p className="font-display text-lg font-bold tracking-tight">{unreadOnly ? n.noUnread : s.noNotifications}</p>
        {unreadOnly ? null : <p className="mt-1.5 text-[13px] text-ink-soft">{s.noNotificationsHint}</p>}
      </Card>
    );
  }

  return (
    <>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-faint" aria-live="polite">
          {unread > 0 ? fill(n.unreadCount, { count: unread }) : s.allRead}
        </p>
        {unread > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setAllRead(true);
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
        {items.map((row) => (
          <li key={row.id}>
            <NotificationCard
              notification={row}
              read={isRead(row)}
              onFollow={() => {
                if (isRead(row)) return;
                setRead((current) => new Set(current).add(row.id));
                startTransition(async () => {
                  await markNotificationRead(row.id);
                  router.refresh();
                });
              }}
            />
          </li>
        ))}
      </ul>

      {cursor ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setFailed(false);
              try {
                const more = await loadNotifications(cursor, unreadOnly);
                setItems((current) => [...current, ...more.items.filter((x) => !current.some((y) => y.id === x.id))]);
                setCursor(more.next_cursor);
              } catch {
                setFailed(true);
              }
            })
          }
          className="mt-4 flex h-11 w-full items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
        >
          {n.loadOlder}
        </button>
      ) : null}
      {failed ? <p className="mt-2 text-center text-xs text-risk">{n.loadFailed}</p> : null}
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
  const headline = useNotificationHeadline()(notification);
  // A badge row's body is the badge name, already in the headline.
  const body = notification.sentence === "badge_earned" ? null : notification.body;

  const inner = (
    <div className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 ${read ? "bg-surface" : "bg-accent-soft/50"}`}>
      {notification.actor ? (
        <Avatar name={notification.actor.name} url={notification.actor.avatar_url} size="h-9 w-9" />
      ) : (
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
          notification.sentence === "badge_earned" ? "bg-accent text-accent-fg" : "bg-bg text-ink-faint"
        }`}>
          <NavIcon d={notification.sentence === "badge_earned" ? TROPHY : BELL} className="h-[17px] w-[17px]" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug">{headline}</p>
        {body ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-soft">{body}</p>
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
