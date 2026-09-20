import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminAuthStats, getAdminDailySeries } from "@/lib/admin/data";
import { DAY_WINDOWS, daysOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { AdminHeader, Breakdown, DaysPicker, Kpi, KpiGrid, Note, Pill, Section, Table, Td, Th, UserCell, fmtDateTime, fmtNum } from "@/components/admin/ui";
import { DailyBars, DailyLines } from "@/components/admin/charts";

// Admin · authentication. Successful sign-ins come from auth.audit_log_entries
// (GoTrue's own log), providers from auth.identities, failures from the
// LOGIN_FAILED events the login form reports. Never a password or a token.
export default async function AdminAuthPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const days = daysOf(await searchParams);
  const [{ t, locale }, s, series] = await Promise.all([getI18n(), getAdminAuthStats(), getAdminDailySeries(days)]);
  const m = t.admin.auth;
  const c = t.admin.common;
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const pts = (key: "logins" | "new_users" | "active_users") => series.map((p) => ({ day: p.day, value: Number(p[key]) }));

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro}>
        <DaysPicker days={days} options={DAY_WINDOWS} href={(d) => `/admin/auth?days=${d}`} label={(d) => fill(c.days, { n: d })} />
      </AdminHeader>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DailyBars title={m.charts.logins} points={pts("logins")} locale={locale} />
        <DailyBars title={m.charts.signups} points={pts("new_users")} locale={locale} accent />
        <DailyLines title={m.charts.active} series={[{ label: m.charts.active, points: pts("active_users"), tone: "accent" }]} locale={locale} />
      </div>

      <div className="mt-4 space-y-4">
        <Section title={m.title} hint={m.tokensHint}>
          <KpiGrid cols={6}>
            <Kpi label={m.loginsTotal} value={n(s.logins_total)} accent />
            <Kpi label={m.loginsToday} value={n(s.logins_today)} />
            <Kpi label={m.logins7d} value={n(s.logins_7d)} />
            <Kpi label={m.logins30d} value={n(s.logins_30d)} />
            <Kpi label={m.unique7d} value={n(s.unique_7d)} />
            <Kpi label={m.unique30d} value={n(s.unique_30d)} />
            <Kpi label={m.neverLoggedIn} value={n(s.never_logged_in)} />
            <Kpi label={m.signups} value={n(s.signups_total)} />
            <Kpi label={m.recoveries} value={n(s.recoveries_30d)} />
            <Kpi label={m.failed24h} value={n(s.failed_24h)} warn={s.failed_24h > 0} />
            <Kpi label={m.failed7d} value={n(s.failed_7d)} />
            <Kpi label={m.failedTotal} value={n(s.failed_total)} />
          </KpiGrid>
        </Section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Section title={m.byProvider}><Breakdown data={s.by_provider} locale={locale} /></Section>
          <Section title={m.loginsByProvider}><Breakdown data={s.logins_by_provider_30d} locale={locale} /></Section>
          <Section title={m.repeated} hint={m.repeatedHint}>
            {s.repeated_failures_24h.length === 0 ? <Note>{m.noRepeated}</Note> : (
              <ul className="divide-y divide-line/60 text-[12.5px]">
                {s.repeated_failures_24h.map((f) => (
                  <li key={f.email} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate font-mono text-[12px]">{f.email}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Pill tone="risk">{fill(m.attempts, { n: f.attempts })}</Pill>
                      <Pill tone={f.known_user ? "warn" : "neutral"}>{f.known_user ? m.knownUser : m.unknownUser}</Pill>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Section title={m.recentLogins}>
            <Table empty={s.recent_logins.length === 0 ? c.empty : null} head={<><Th>{m.th.when}</Th><Th>{m.th.user}</Th><Th>{m.th.provider}</Th><Th>{m.th.ip}</Th></>}>
              {s.recent_logins.map((l, i) => (
                <tr key={i}>
                  <Td nowrap className="text-ink-soft">{fmtDateTime(l.at, locale)}</Td>
                  <Td>{l.user_id ? <UserCell id={l.user_id} name={l.full_name} username={l.username} sub={l.email} /> : <span className="text-ink-faint">{c.unknownUser}</span>}</Td>
                  <Td nowrap>{l.provider ?? c.none}</Td>
                  <Td className="font-mono text-[12px] text-ink-faint">{l.ip || c.none}</Td>
                </tr>
              ))}
            </Table>
          </Section>
          <Section title={m.lastPerUser}>
            <Table empty={s.last_login_per_user.length === 0 ? c.empty : null} head={<><Th>{m.th.user}</Th><Th>{m.th.lastLogin}</Th><Th>{m.th.provider}</Th></>}>
              {s.last_login_per_user.map((u) => (
                <tr key={u.user_id}>
                  <Td><UserCell id={u.user_id} name={u.full_name} username={u.username} sub={u.email} /></Td>
                  <Td nowrap className="text-ink-soft">{u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at, locale) : <span className="text-ink-faint">{c.never}</span>}</Td>
                  <Td nowrap>{u.provider}</Td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-[12px] text-ink-faint"><Link href="/admin/users?sort=last_active" className="hover:text-ink">{t.admin.nav.users} →</Link></p>
          </Section>
        </div>
      </div>
    </div>
  );
}
