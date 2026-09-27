"use client";
import Link from "next/link";
import { useEffect, useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadNotifications, markNotificationRead, markNotificationsRead } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import {
  READ_NONE, groupByDay, isRowRead, notificationHeadline, notificationKind, readReducer, unreadLeft,
  type NotificationKind,
} from "@/lib/notification-format";
import { Card } from "./ui";
import { Avatar, useSocialFormat } from "./social";
import { NavIcon } from "./client-nav";
import type { NotificationPage, NotificationRow } from "@/lib/notifications-data";

const BELL = "M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";

/** The small mark on a card's avatar, one per kind of event. */
const KIND_ICON: Record<NotificationKind, string> = {
  follow: "M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6",
  kudos: "M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 4-4 6-4 12 0 4 3 7 7 7z",
  comment: "M4 5h16v11H9l-5 4z",
  mention: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  badge: TROPHY,
  challenge: TROPHY,
  system: BELL,
};

/**
 * The line a notification reads as: a sentence about a person for the social
 * categories, the achievement's name for a badge, and the engine's own title
 * otherwise. Shared by this list and the bell so the two never disagree.
 */
export function useNotificationHeadline() {
  const { t, locale } = useI18n();
  const strings = { notified: t.common.social.notified, someone: t.common.notifications.someone };
  // The rule itself is notificationHeadline (lib/notification-format, tested).
  return (n: NotificationRow): string => notificationHeadline(n, strings, locale === "ro" ? "ro" : "en");
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
  page, unread: unreadTotal, unreadOnly, now, timeZone,
}: {
  page: NotificationPage;
  unread: number;
  unreadOnly: boolean;
  /** The server's render time: Today / Yesterday are computed from it on both sides. */
  now: string;
  /** The reader's own time zone, for which calendar day a row falls on. */
  timeZone: string;
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
  // navigation and the refresh have both landed (readReducer, tested).
  const [readState, dispatch] = useReducer(readReducer, READ_NONE);

  // A refresh (after marking read) brings a new first page down.
  // The optimistic marks are reset with it: the server's read_at is the truth now.
  useEffect(() => {
    setItems(page.items);
    setCursor(page.next_cursor);
    dispatch({ type: "reset" });
  }, [page]);

  const isRead = (row: NotificationRow) => isRowRead(readState, row);
  const unread = unreadLeft(readState, unreadTotal, items);
  const groups = groupByDay(items, now, timeZone);
  const groupLabel = { today: n.today, yesterday: n.yesterday, earlier: n.earlier };

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
                dispatch({ type: "markAll" });
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

      {groups.map((group) => (
        <section key={group.bucket} aria-labelledby={`notifications-${group.bucket}`} className="mt-5 first-of-type:mt-3">
          <h2 id={`notifications-${group.bucket}`} className="px-1 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-faint">
            {groupLabel[group.bucket]}
          </h2>
          <ul className="mt-2 space-y-2">
            {group.rows.map((row) => (
              <li key={row.id}>
                <NotificationCard
                  notification={row}
                  read={isRead(row)}
                  onFollow={() => {
                    if (isRead(row)) return;
                    dispatch({ type: "mark", id: row.id });
                    startTransition(async () => {
                      await markNotificationRead(row.id);
                      router.refresh();
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

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
  const { t } = useI18n();
  const f = useSocialFormat();
  const s = t.common.social;
  const headline = useNotificationHeadline()(notification);
  const kind = notificationKind(notification.sentence);
  // A badge row's body is the badge name, already in the headline.
  const body = notification.sentence === "badge_earned" ? null : notification.body;

  const inner = (
    <div className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 ${read ? "bg-surface" : "bg-accent-soft/50"}`}>
      <span className="relative shrink-0">
        {notification.actor ? (
          <Avatar name={notification.actor.name} url={notification.actor.avatar_url} size="h-10 w-10" />
        ) : (
          <span className={`grid h-10 w-10 place-items-center rounded-full ${
            kind === "badge" || kind === "challenge" ? "bg-accent text-accent-fg" : "bg-bg text-ink-faint"
          }`}>
            <NavIcon d={KIND_ICON[kind]} className="h-[18px] w-[18px]" />
          </span>
        )}
        {/* What happened, at a glance — on a face; an icon-only avatar already says it. */}
        {notification.actor ? (
          <span aria-hidden className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-accent-fg ring-2 ring-surface">
            <NavIcon d={KIND_ICON[kind]} className="h-[10px] w-[10px] [stroke-width:2.6]" />
          </span>
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug">{headline}</p>
        {body ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-soft">{body}</p>
        ) : null}
        <time dateTime={notification.created_at} title={f.at(notification.created_at)} suppressHydrationWarning className="mt-1 block text-[11.5px] text-ink-faint">
          {f.when(notification.created_at)}
        </time>
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
