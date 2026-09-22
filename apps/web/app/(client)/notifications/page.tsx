import { getMyNotifications } from "@/lib/notifications-data";
import { NotificationList } from "@/components/notification-list";
import { getI18n } from "@/lib/i18n/server";

/**
 * Every notification, with who did it.
 *
 * The bell is a glance; this is the list. Opening it marks nothing read — that
 * happens when one is followed, or when "mark all as read" is pressed.
 */
export default async function NotificationsPage() {
  const { t } = await getI18n();
  const notifications = await getMyNotifications(50);

  return (
    <div className="mx-auto max-w-[680px]">
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">
        {t.common.social.notifications}
      </h1>
      <NotificationList notifications={notifications} />
    </div>
  );
}
