import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminChallenges } from "@/lib/admin/data";
import { getI18n } from "@/lib/i18n/server";
import { AdminHeader, Kpi, KpiGrid, Pill, Section, Table, Td, Th, fmtDate, fmtNum } from "@/components/admin/ui";

// Admin · challenges: active / upcoming / finished with participation.
export default async function AdminChallengesPage() {
  await requireAdmin();
  const [{ t, locale }, { stats, rows }] = await Promise.all([getI18n(), getAdminChallenges()]);
  const m = t.admin.challenges;
  const c = t.admin.common;
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const tone = (s: string) => (s === "active" ? "accent" : s === "upcoming" ? "warn" : "neutral") as "accent" | "warn" | "neutral";

  return (
    <div>
      <AdminHeader title={m.title} />
      <KpiGrid cols={5}>
        <Kpi label={m.stats.total} value={n(stats.total)} accent href="/admin/challenges" />
        <Kpi label={m.stats.active} value={n(stats.active)} />
        <Kpi label={m.stats.upcoming} value={n(stats.upcoming)} />
        <Kpi label={m.stats.finished} value={n(stats.finished)} />
        <Kpi label={m.stats.rate} value={stats.completion_rate === null ? c.none : `${n(stats.completion_rate)}%`} />
        <Kpi label={m.stats.participants} value={n(stats.participants)} href="/admin/activity?action=CHALLENGE_JOINED" />
        <Kpi label={m.stats.completions} value={n(stats.completions)} href="/admin/activity?action=CHALLENGE_COMPLETED" />
        <Kpi label={m.stats.platform} value={n(stats.platform)} />
        <Kpi label={m.stats.user} value={n(stats.user_created)} />
      </KpiGrid>
      <Section title={`${n(rows.length)} · ${c.total}`} className="mt-4">
        <Table empty={rows.length === 0 ? c.empty : null} head={<>
          <Th>{m.th.title}</Th><Th>{m.th.status}</Th><Th>{m.th.type}</Th><Th className="text-right">{m.th.target}</Th><Th>{m.th.window}</Th><Th>{m.th.visibility}</Th>
          <Th className="text-right">{m.th.participants}</Th><Th className="text-right">{m.th.completions}</Th><Th>{m.th.creator}</Th>
        </>}>
          {rows.map((ch) => (
            <tr key={ch.id}>
              <Td className="font-semibold"><Link href={`/admin/challenges/${ch.id}`} className="hover:text-accent-ink">{locale === "ro" ? ch.title_ro : ch.title_en}</Link></Td>
              <Td nowrap><Pill tone={tone(ch.status)}>{m.statuses[ch.status]}</Pill></Td>
              <Td nowrap className="text-ink-soft">{m.types[ch.type as keyof typeof m.types] ?? ch.type}</Td>
              <Td className="text-right tabular-nums">{n(ch.target_value)}</Td>
              <Td nowrap className="text-ink-soft">{fmtDate(ch.start_date, locale)} → {fmtDate(ch.end_date, locale)}</Td>
              <Td nowrap className="text-ink-soft">{ch.visibility}</Td>
              <Td className="text-right tabular-nums">{n(ch.participants)}</Td>
              <Td className="text-right tabular-nums">{n(ch.completions)}</Td>
              <Td nowrap>{ch.creator_id ? <Link href={`/admin/users/${ch.creator_id}`} className="hover:text-accent-ink">@{ch.creator_username ?? ch.creator_id.slice(0, 8)}</Link> : <span className="text-ink-faint">{m.platform}</span>}</Td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
