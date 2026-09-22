import { requireAdmin } from "@/lib/admin/guard";
import { getAdminNotificationStats } from "@/lib/admin/data";
import { getI18n } from "@/lib/i18n/server";
import { AdminHeader, Breakdown, Kpi, KpiGrid, Note, Section, Table, Td, Th, UserCell, fmtDateTime, fmtNum } from "@/components/admin/ui";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { removePushSubscription } from "@/app/admin-actions";

// Admin · push subscriptions and the notifications table. Endpoint, p256dh
// and auth never leave the database: the RPC selects around them.
export default async function AdminNotificationsPage() {
  await requireAdmin();
  const [{ t, locale }, s] = await Promise.all([getI18n(), getAdminNotificationStats()]);
  const m = t.admin.notifications;
  const c = t.admin.common;
  const n = (v: number | null | undefined) => fmtNum(v, locale);

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro} />
      <KpiGrid cols={5}>
        <Kpi label={m.usersWithPush} value={n(s.users_with_push)} accent sub={`${n(s.users_total)} ${c.total}`} href="/admin/activity?action=PUSH_SUBSCRIBED" />
        <Kpi label={m.usersWithout} value={n(s.users_without_push)} href="/admin/users" />
        <Kpi label={m.subscriptions} value={n(s.subscriptions)} sub={`${n(s.subscriptions_7d)} · ${m.subscriptions7d.toLowerCase()}`} />
        <Kpi label={m.restNotifyOn} value={n(s.users_rest_notify_on)} />
        <Kpi label={m.lastSent} value={<span className="text-[14px]">{fmtDateTime(s.rest_pushes.last_sent_at, locale)}</span>} />
      </KpiGrid>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title={m.restPushes} hint={m.deliveredHint}>
          <KpiGrid cols={3}>
            <Kpi label={m.sent} value={n(s.rest_pushes.sent)} accent />
            <Kpi label={m.cancelled} value={n(s.rest_pushes.cancelled)} />
            <Kpi label={m.pending} value={n(s.rest_pushes.pending)} />
            <Kpi label={m.sent24h} value={n(s.rest_pushes.sent_24h)} />
            <Kpi label={m.sent7d} value={n(s.rest_pushes.sent_7d)} />
            <Kpi label="delivered / failed" value="—" unavailable={m.deliveredHint} />
          </KpiGrid>
        </Section>
        <Section title={m.inApp}>
          <KpiGrid cols={2}>
            <Kpi label={c.total} value={n(s.notifications.total)} accent />
            <Kpi label={m.created7d} value={n(s.notifications.created_7d)} />
            <Kpi label={m.unsent} value={n(s.notifications.unsent)} warn={s.notifications.unsent > 0} />
            <Kpi label={m.unread} value={n(s.notifications.unread)} />
          </KpiGrid>
          <h3 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.byCategory}</h3>
          <Breakdown data={s.notifications.by_category} locale={locale} />
        </Section>
        <Section title={m.byBrowser}><Breakdown data={s.by_browser} locale={locale} /></Section>
      </div>
      <Section title={m.recent} className="mt-4">
        <Table empty={s.recent_subscriptions.length === 0 ? c.empty : null} head={<><Th>{m.th.user}</Th><Th>{m.th.browser}</Th><Th>{m.th.registered}</Th><Th>{m.th.updated}</Th><Th></Th></>}>
          {s.recent_subscriptions.map((sub) => (
            <tr key={sub.id}>
              <Td><UserCell id={sub.user_id} name={sub.full_name} username={sub.username} /></Td>
              <Td className="max-w-[420px] truncate text-[12px] text-ink-soft" ><span title={sub.user_agent ?? ""}>{sub.user_agent ?? c.none}</span></Td>
              <Td nowrap className="text-ink-soft">{fmtDateTime(sub.created_at, locale)}</Td>
              <Td nowrap className="text-ink-soft">{fmtDateTime(sub.updated_at, locale)}</Td>
              <Td nowrap><ConfirmAction label={m.remove} title={t.admin.user.devices.removeTitle} body={t.admin.user.devices.removeBody} tone="neutral" action={removePushSubscription.bind(null, sub.id, sub.user_id)} /></Td>
            </tr>
          ))}
        </Table>
        <Note>{m.intro}</Note>
      </Section>
    </div>
  );
}
