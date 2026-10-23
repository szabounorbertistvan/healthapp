import type { NotificationsV1 } from "@healthapp/api/v1";
import { apiJson, v1Route } from "@/lib/api/v1";
import { getI18n } from "@/lib/i18n/server";
import { notificationHeadline } from "@/lib/notification-format";
import { getNotificationPage } from "@/lib/notifications-data";

// The notifications center (?before= cursor): the web's page of rows, each
// with its headline already in the reader's language.
export const dynamic = "force-dynamic";

export const GET = v1Route(async (request) => {
  const before = new URL(request.url).searchParams.get("before");
  const [{ t, locale }, page] = await Promise.all([getI18n(), getNotificationPage({ before })]);
  const strings = { notified: t.common.social.notified, someone: t.common.notifications.someone };
  return apiJson<NotificationsV1>({
    next_cursor: page.next_cursor,
    items: page.items.map((n) => ({
      id: n.id,
      category: n.category,
      headline: notificationHeadline(n, strings, locale),
      body: n.sentence ? null : n.body,
      created_at: n.created_at,
      read: n.read,
      href: n.href,
    })),
  });
});
