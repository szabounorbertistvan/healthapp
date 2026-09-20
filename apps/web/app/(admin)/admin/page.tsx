import { requireAdmin } from "@/lib/admin/guard";
import { getAdminDailySeries, getAdminOverview } from "@/lib/admin/data";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { AdminHeader, Kpi, KpiGrid, Note, Section, fmtDateTime, fmtNum } from "@/components/admin/ui";
import { DailyBars, DailyLines } from "@/components/admin/charts";

// Admin · overview. One aggregate RPC for the tiles and one for the 30-day
// series; both go out in the same wave. Every number is computed in SQL from
// the live tables — nothing is estimated, and a metric the data cannot
// answer says so instead of showing a zero.
export default async function AdminOverviewPage() {
  await requireAdmin();
  const [{ t, locale }, o, series] = await Promise.all([getI18n(), getAdminOverview(), getAdminDailySeries(30)]);
  const m = t.admin.overview;
  const c = t.admin.common;
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const pts = (key: keyof (typeof series)[number]) => series.map((p) => ({ day: p.day, value: Number(p[key]) }));

  return (
    <div>
      <AdminHeader title={m.title} intro={fill(m.generated, { time: fmtDateTime(o.generated_at, locale) })} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DailyBars title={m.charts.growth} points={pts("new_users")} locale={locale} />
        <DailyLines title={m.charts.active} series={[{ label: m.charts.active, points: pts("active_users"), tone: "accent" }, { label: m.charts.logins, points: pts("logins"), tone: "ink" }]} locale={locale} />
        <DailyBars title={m.charts.workouts} points={pts("workouts")} locale={locale} accent />
        <DailyLines title={m.charts.social} series={[{ label: m.charts.social, points: pts("posts"), tone: "accent" }, { label: m.charts.invitations, points: pts("invitations"), tone: "warn" }]} locale={locale} />
      </div>
      <Note>{m.activeDefinition}</Note>

      <div className="mt-5 space-y-4">
        <Section title={m.users}>
          <KpiGrid cols={6}>
            <Kpi label={m.totalUsers} value={n(o.users.total)} accent />
            <Kpi label={m.clients} value={n(o.users.clients)} />
            <Kpi label={m.coaches} value={n(o.users.coaches)} />
            <Kpi label={m.admins} value={n(o.users.admins)} />
            <Kpi label={m.createdToday} value={n(o.users.created_today)} />
            <Kpi label={m.created7d} value={n(o.users.created_7d)} />
            <Kpi label={m.created30d} value={n(o.users.created_30d)} />
            <Kpi label={m.active30d} value={n(o.users.active_30d)} />
            <Kpi label={m.inactive30d} value={n(o.users.inactive_30d)} />
            <Kpi label={m.withCoach} value={n(o.users.with_coach)} />
            <Kpi label={m.suspended} value={n(o.users.suspended)} warn={o.users.suspended > 0} />
            <Kpi label={m.deletionPending} value={n(o.users.deletion_pending)} warn={o.users.deletion_pending > 0} />
          </KpiGrid>
        </Section>

        <Section title={m.activity}>
          <KpiGrid cols={6}>
            <Kpi label={m.workoutsToday} value={n(o.activity.workouts_today)} accent />
            <Kpi label={m.workouts7d} value={n(o.activity.workouts_7d)} />
            <Kpi label={m.setsToday} value={n(o.activity.sets_today)} />
            <Kpi label={m.sets7d} value={n(o.activity.sets_7d)} />
            <Kpi label={m.activeToday} value={n(o.activity.active_today)} />
            <Kpi label={m.active7d} value={n(o.activity.active_7d)} />
            <Kpi label={m.streakUsers} value={n(o.activity.streak_users)} />
            <Kpi label={m.challengesActive} value={n(o.activity.challenges_active)} />
            <Kpi label={m.challengeParticipants} value={n(o.activity.challenge_participants_active)} />
            <Kpi label={m.foodLogsToday} value={n(o.activity.food_logs_today)} />
            <Kpi label={m.programsPublished} value={n(o.activity.programs_published)} />
            <Kpi label={m.habitsActive} value={n(o.activity.habits_active)} />
          </KpiGrid>
        </Section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title={m.auth}>
            <KpiGrid cols={3}>
              <Kpi label={m.loginsTotal} value={n(o.auth.logins_total)} accent />
              <Kpi label={m.loginsToday} value={n(o.auth.logins_today)} />
              <Kpi label={m.logins7d} value={n(o.auth.logins_7d)} />
              <Kpi label={m.logins30d} value={n(o.auth.logins_30d)} />
              <Kpi label={m.failed24h} value={n(o.auth.failed_24h)} warn={o.auth.failed_24h > 0} sub={`${n(o.auth.failed_total)} ${c.total}`} />
              <Kpi label={m.neverLoggedIn} value={n(o.auth.never_logged_in)} />
              <Kpi label={m.googleAccounts} value={n(o.auth.google_accounts)} />
              <Kpi label={m.emailAccounts} value={n(o.auth.email_accounts)} />
              <Kpi label={m.lastLogin} value={<span className="text-[15px]">{fmtDateTime(o.auth.last_login_at, locale)}</span>} />
            </KpiGrid>
          </Section>

          <Section title={m.invitations}>
            <KpiGrid cols={3}>
              <Kpi label={m.invTotal} value={n(o.invitations.total)} accent />
              <Kpi label={m.invPending} value={n(o.invitations.pending)} />
              <Kpi label={m.invAccepted} value={n(o.invitations.accepted)} />
              <Kpi label={m.invExpired} value={n(o.invitations.expired)} />
              <Kpi label={m.invRate} value={o.invitations.acceptance_rate === null ? c.none : `${n(o.invitations.acceptance_rate)}%`} />
              <Kpi label={m.inv7d} value={n(o.invitations.created_7d)} sub={`${n(o.invitations.created_30d)} · ${c.last30}`} />
            </KpiGrid>
          </Section>

          <Section title={m.social}>
            <KpiGrid cols={3}>
              <Kpi label={m.posts} value={n(o.social.posts)} accent sub={`${n(o.social.posts_7d)} · ${c.last7}`} />
              <Kpi label={m.comments} value={n(o.social.comments)} sub={`${n(o.social.comments_7d)} · ${c.last7}`} />
              <Kpi label={m.kudos} value={n(o.social.kudos)} sub={`${n(o.social.kudos_7d)} · ${c.last7}`} />
              <Kpi label={m.follows} value={n(o.social.follows)} sub={`${n(o.social.follows_7d)} · ${c.last7}`} />
            </KpiGrid>
          </Section>

          <Section title={m.system}>
            <KpiGrid cols={3}>
              <Kpi label={m.pushSubs} value={n(o.system.push_subscriptions)} accent />
              <Kpi label={m.usersWithPush} value={n(o.system.users_with_push)} />
              <Kpi label={m.usersWithoutPush} value={n(o.system.users_without_push)} />
              <Kpi label={m.restPushes7d} value={n(o.system.rest_pushes_sent_7d)} />
              <Kpi label={m.notificationsUnsent} value={n(o.system.notifications_unsent)} />
              <Kpi label={m.auditEvents24h} value={n(o.system.audit_events_24h)} sub={`${n(o.system.admin_actions_30d)} ${m.adminActions30d.toLowerCase()}`} />
              <Kpi label={m.errors} value="—" unavailable={m.errorsHint} />
            </KpiGrid>
          </Section>
        </div>
      </div>
    </div>
  );
}
