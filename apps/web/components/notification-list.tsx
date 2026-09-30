"use client";
import Link from "next/link";
import { useEffect, useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadNotifications, markNotificationRead, markNotificationsRead } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { READ_NONE, isRowRead, readReducer, unreadLeft } from "@/lib/notification-format";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { Avatar, useSocialFormat } from "./social";
import { NavIcon } from "./client-nav";
import { ReactionIcon } from "./reaction-icons";
import type { NotificationPage, NotificationRow } from "@/lib/notifications-data";

const BELL = "M12 4a5 5 0 0 0-5 5v3l-1.5 3h13L17 12V9a5 5 0 0 0-5-5M10 18a2 2 0 0 0 4 0";
const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4";
const COMMENT = "M4 5h16v11H9l-5 4z";
const PERSON_PLUS = "M15 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 8v6M16 11h6";
const DUMBBELL = "M6.5 6.5v11M9.5 8.5v7M14.5 8.5v7M17.5 6.5v11M9.5 12h5";
const QUOTE = "M7 7h4v4H7zM13 7h4v4h-4zM7 11c0 3 1 4 3 5M13 11c0 3 1 4 3 5";
const AT = "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8m4-4v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1";

/**
 * The second line under the headline, when it says something the headline
 * does not: a comment's or a mention's text. A badge row's body is the badge
 * name (already the headline), and a reaction's or a follow's body is the
 * database's own English sentence — the headline in the reader's language
 * already says it.
 */
export function notificationBody(n: NotificationRow): string | null {
  switch (n.sentence) {
    case "badge_earned":
    case "new_kudos":
    case "new_love":
    case "new_follower":
      return null;
    default:
      return n.body;
  }
}

/**
 * The line a notification reads as, as a template and its `{name}`: a
 * sentence about a person for the social categories, the achievement's name
 * for a badge, the engine's own title otherwise. The row sets the name in
 * bold and the rest plain, which is what makes a list of these scannable.
 * Shared by the list and the bell so the two never disagree.
 */
export function useNotificationHeadline() {
  const { t, locale } = useI18n();
  const s = t.common.social;
  return (n: NotificationRow): { template: string; name: string | null } => {
    if (n.sentence === "badge_earned") {
      const name = n.badge ? (locale === "ro" ? n.badge.ro : n.badge.en) : n.body ?? "";
      return { template: s.notified.badge_earned, name };
    }
    if ((n.sentence === "challenge_milestone" || n.sentence === "challenge_completed") && n.challenge) {
      const name = locale === "ro" ? n.challenge.ro : n.challenge.en;
      return { template: fill(s.notified[n.sentence], { pct: n.challenge.milestone }), name };
    }
    if (n.sentence === "challenge_milestone" || n.sentence === "challenge_completed") return { template: n.title, name: null };
    // An actor hidden from the reader (block, suspension, deletion) comes
    // back as null; the row still reads as a sentence, about "someone".
    if (n.sentence) return { template: s.notified[n.sentence], name: n.actor?.name ?? t.common.notifications.someone };
    return { template: n.title, name: null };
  };
}

/** The headline with its name in bold. */
function Headline({ notification, className = "" }: { notification: NotificationRow; className?: string }) {
  const { template, name } = useNotificationHeadline()(notification);
  if (name === null || !template.includes("{name}")) {
    return <p className={`font-semibold leading-snug ${className}`}>{fill(template, { name: name ?? "" })}</p>;
  }
  const [before, after] = template.split("{name}");
  return (
    <p className={`leading-snug ${className}`}>
      {before}
      <span className="font-bold">{name}</span>
      {after}
    </p>
  );
}

/** What the row is about, drawn in the corner of the avatar. */
function Glyph({ notification }: { notification: NotificationRow }) {
  const kind = notification.sentence;
  if (kind === "new_kudos" || kind === "new_love") {
    return (
      <span className="absolute -bottom-1 -right-1.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-surface ring-2 ring-surface">
        <ReactionIcon type={kind === "new_kudos" ? "kudos" : "love"} className="h-[18px] w-[18px]" />
      </span>
    );
  }
  const icon =
    kind === "new_comment" || kind === "comment_reply" ? COMMENT
    : kind === "new_mention" || kind === "new_mention_post" ? AT
    : kind === "new_follower" ? PERSON_PLUS
    : kind === "badge_earned" || kind === "challenge_completed" || kind === "challenge_milestone" ? TROPHY
    : null;
  if (!icon) return null;
  return (
    <span className="absolute -bottom-1 -right-1.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-accent text-accent-fg ring-2 ring-surface">
      <NavIcon d={icon} className="h-3 w-3 [stroke-width:2.4]" />
    </span>
  );
}

/** The post on the right: its photo, or a tile that says what kind of post it was. */
function Thumb({ post }: { post: NonNullable<NotificationRow["post"]> }) {
  if (post.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={post.photo_url} alt="" aria-hidden loading="lazy" className="h-11 w-11 shrink-0 rounded-xl bg-bg object-cover" />
    );
  }
  const icon = post.type === "workout" || post.type === "program" ? DUMBBELL
    : post.type === "pr" || post.type === "achievement" || post.type === "challenge_completed" || post.type === "streak" || post.type === "fitness_score" ? TROPHY
    : QUOTE;
  const gold = post.type !== "workout" && post.type !== "program" && post.type !== "text" && post.type !== "progress";
  return (
    <span
      title={post.label ?? undefined}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${gold ? "bg-accent text-accent-fg" : "bg-tile text-tile-ink"}`}
    >
      <NavIcon d={icon} className="h-5 w-5" />
    </span>
  );
}

/**
 * One notification, the way the feeds people know draw it: who did it (avatar,
 * with what they did in the corner), the sentence with the name in bold, the
 * comment's words when there are any, when — and on the right the post it
 * happened on. `compact` is the bell's panel; the page uses the full row.
 */
export function NotificationRowView({ notification, unread, compact = false }: {
  notification: NotificationRow;
  unread: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const f = useSocialFormat();
  const body = notificationBody(notification);
  const size = compact ? "h-9 w-9" : "h-10 w-10";
  const engine = !notification.actor && notification.sentence !== "badge_earned";
  return (
    <div className={`flex items-center gap-3 ${compact ? "px-4 py-3" : "px-4 py-3.5"}`}>
      <span className="relative shrink-0">
        {notification.actor ? (
          <Avatar name={notification.actor.name} url={notification.actor.avatar_url} size={size} />
        ) : (
          <span className={`grid ${size} place-items-center rounded-full ${engine ? "bg-bg text-ink-faint" : "bg-accent text-accent-fg"}`}>
            <NavIcon d={engine ? BELL : TROPHY} className="h-[17px] w-[17px]" />
          </span>
        )}
        <Glyph notification={notification} />
      </span>
      <div className="min-w-0 flex-1">
        <Headline notification={notification} className={compact ? "text-[13px]" : "text-[13.5px]"} />
        {body ? (
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-soft">{body}</p>
        ) : null}
        {notification.post_unavailable ? (
          // The row stays as history but no longer leads anywhere (href is null).
          <p className="mt-0.5 text-[12px] italic text-ink-faint">{t.common.social.postGone}</p>
        ) : null}
        <p className="mt-0.5 text-[11.5px] text-ink-faint">{f.when(notification.created_at)}</p>
      </div>
      {notification.post ? <Thumb post={notification.post} /> : null}
      {unread ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={t.common.social.unread} />
      ) : null}
    </div>
  );
}

/**
 * Which heading a row files under: today, the last seven days, or before
 * that. "Today" is the calendar day in the reader's own time zone, counted
 * from the server's render time, so server and browser file a row the same.
 */
function groupOf(iso: string, now: number, timeZone: string): "today" | "week" | "earlier" {
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone });
  const at = Date.parse(iso);
  if (day(at) === day(now)) return "today";
  return now - at < 7 * 86_400_000 ? "week" : "earlier";
}

/**
 * The notifications center list, in three groups (today, this week, earlier).
 *
 * Read state is explicit: a row marks itself read when it is followed, and
 * "mark all as read" does the rest. Rendering the page does nothing — an
 * unread badge that clears itself because you looked at it is not a badge.
 * Older rows page in on a created_at cursor.
 */
export function NotificationList({
  page, unread: unreadTotal, unreadOnly, now: nowIso, timeZone,
}: {
  page: NotificationPage;
  unread: number;
  unreadOnly: boolean;
  /** The server's render time: the groups are computed from it on both sides. */
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
  // Fixed at render, so a row does not hop between groups while you read.
  const [now] = useState(() => Date.parse(nowIso));

  // A refresh (after marking read) brings a new first page down.
  // The optimistic marks are reset with it: the server's read_at is the truth now.
  useEffect(() => {
    setItems(page.items);
    setCursor(page.next_cursor);
    dispatch({ type: "reset" });
  }, [page]);

  const isRead = (row: NotificationRow) => isRowRead(readState, row);
  const unread = unreadLeft(readState, unreadTotal, items);

  if (items.length === 0) {
    return (
      <Card plain className="mt-5 py-10 text-center">
        <p className="font-display text-lg font-bold tracking-tight">{unreadOnly ? n.noUnread : s.noNotifications}</p>
        {unreadOnly ? null : <p className="mt-1.5 text-[13px] text-ink-soft">{s.noNotificationsHint}</p>}
      </Card>
    );
  }

  const groups: { key: "today" | "week" | "earlier"; label: string; rows: NotificationRow[] }[] = [
    { key: "today", label: n.groupToday, rows: [] },
    { key: "week", label: n.groupWeek, rows: [] },
    { key: "earlier", label: n.groupEarlier, rows: [] },
  ];
  for (const row of items) groups.find((g) => g.key === groupOf(row.created_at, now, timeZone))!.rows.push(row);

  const follow = (row: NotificationRow) => {
    if (isRead(row)) return;
    dispatch({ type: "mark", id: row.id });
    startTransition(async () => {
      await markNotificationRead(row.id);
      router.refresh();
    });
  };

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
            className="inline-flex h-9 cursor-pointer items-center rounded-full bg-surface px-3.5 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
          >
            {s.markAllRead}
          </button>
        ) : null}
      </div>

      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.key} className="mt-5">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{g.label}</h2>
          <ul className="mt-2 overflow-hidden rounded-3xl bg-surface">
            {g.rows.map((row) => {
              const unreadRow = !isRead(row);
              const inner = <NotificationRowView notification={row} unread={unreadRow} />;
              return (
                <li key={row.id} className={`border-t border-line/50 first:border-t-0 ${unreadRow ? "bg-accent-soft/40" : ""}`}>
                  {row.href ? (
                    <Link href={row.href} onClick={() => follow(row)} className="block transition hover:bg-bg/60">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
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
          className="mt-4 flex h-11 w-full cursor-pointer items-center justify-center rounded-2xl bg-surface px-5 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
        >
          {n.loadOlder}
        </button>
      ) : null}
      {failed ? <p className="mt-2 text-center text-xs text-risk">{n.loadFailed}</p> : null}
    </>
  );
}
