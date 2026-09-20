import { requireAdmin } from "@/lib/admin/guard";
import { getAdminChallengeDetail } from "@/lib/admin/data";
import { uuidOf } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { AdminHeader, Facts, Pill, Section, Table, Td, Th, UserCell, fmtDate, fmtDateTime, fmtNum } from "@/components/admin/ui";

/** Progress toward the target from the rollups the RPC returns, by challenge type. */
function progressOf(type: string, p: { workouts: number; active_days: number; volume_kg: number; load: number }): number {
  switch (type) {
    case "workouts": return p.workouts;
    case "active_days": return p.active_days;
    case "volume": return Number(p.volume_kg);
    case "training_load": return p.load;
    default: return 0;
  }
}

// Admin · one challenge with every participant's progress.
export default async function AdminChallengePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { t, locale } = await getI18n();
  const m = t.admin.challenges;
  const c = t.admin.common;
  const id = uuidOf((await params).id);
  const ch = id ? await getAdminChallengeDetail(id) : null;
  if (!ch) return <p className="text-sm text-ink-soft">{m.detail.notFound}</p>;
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const target = Number(ch.target_value);

  return (
    <div>
      <AdminHeader title={locale === "ro" ? ch.title_ro : ch.title_en} intro={(locale === "ro" ? ch.description_ro : ch.description_en) ?? undefined}>
        <Pill tone={ch.status === "active" ? "accent" : ch.status === "upcoming" ? "warn" : "neutral"}>{m.statuses[ch.status]}</Pill>
      </AdminHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Section title={m.title}>
          <Facts items={[
            { label: c.id, value: ch.id, mono: true },
            { label: m.th.type, value: m.types[ch.type as keyof typeof m.types] ?? ch.type },
            { label: m.th.target, value: n(target) },
            { label: m.th.window, value: `${fmtDate(ch.start_date, locale)} → ${fmtDate(ch.end_date, locale)}` },
            { label: m.th.visibility, value: ch.visibility },
            { label: m.th.creator, value: ch.creator ? `@${ch.creator.username ?? ch.creator.full_name}` : m.platform },
            { label: c.created, value: fmtDateTime(ch.created_at, locale) },
            { label: m.stats.participants, value: n(ch.participants.length) },
            { label: m.stats.completions, value: n(ch.participants.filter((p) => p.completed_at).length) },
          ]} />
        </Section>
        <Section title={`${m.detail.participants} · ${ch.participants.length}`}>
          <Table empty={ch.participants.length === 0 ? m.detail.noParticipants : null} head={<>
            <Th>{c.user}</Th><Th>{m.detail.progress}</Th><Th className="text-right">{m.detail.workouts}</Th><Th className="text-right">{m.detail.activeDays}</Th>
            <Th className="text-right">{m.detail.volume}</Th><Th className="text-right">{m.detail.load}</Th><Th>{m.detail.joined}</Th><Th>{m.detail.completed}</Th>
          </>}>
            {ch.participants.map((p) => {
              const prog = progressOf(ch.type, p);
              const pct = target > 0 ? Math.min(100, Math.round((100 * prog) / target)) : 0;
              return (
                <tr key={p.user_id}>
                  <Td><UserCell id={p.user_id} name={p.full_name} username={p.username} avatar={p.avatar_url} /></Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-24 rounded-full bg-line/60"><span className="block h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
                      <span className="tabular-nums text-[12px] text-ink-soft">{n(prog)} / {n(target)}</span>
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">{n(p.workouts)}</Td>
                  <Td className="text-right tabular-nums">{n(p.active_days)}</Td>
                  <Td className="text-right tabular-nums">{n(Number(p.volume_kg))}</Td>
                  <Td className="text-right tabular-nums">{n(p.load)}</Td>
                  <Td nowrap className="text-ink-soft">{fmtDate(p.joined_at, locale)}</Td>
                  <Td nowrap>{p.completed_at ? <Pill tone="accent">{fmtDate(p.completed_at, locale)}</Pill> : <span className="text-ink-faint">{c.none}</span>}</Td>
                </tr>
              );
            })}
          </Table>
        </Section>
      </div>
    </div>
  );
}
