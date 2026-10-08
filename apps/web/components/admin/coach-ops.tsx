import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";
import { formatPrice } from "@/lib/coach-onboarding";
import type { AdminCoachSummary, AttentionRow } from "@/lib/admin/marketplace-data";
import { Breakdown, Kpi, KpiGrid, Note, Pill, Section, Table, Td, Th, fmtDateTime, fmtNum } from "./ui";

/**
 * /admin/coaches/[id] (20261112100000): the coach's marketplace numbers —
 * counts only, no client named — their services as they stand (active or
 * not), and the moderation history from the audit trail.
 */
export async function AdminCoachOps({ summary }: { summary: AdminCoachSummary }) {
  const { t, locale } = await getI18n();
  const o = t.admin.coaches.ops;
  const avg = summary.review_avg === null ? null : Number(summary.review_avg);
  return (
    <div className="grid gap-4">
      <Section title={o.title} hint={o.hint}>
        <div data-testid="admin-coach-ops">
          <KpiGrid cols={5}>
            <Kpi label={o.views} value={fmtNum(summary.views_30d, locale)} />
            <Kpi label={o.saves} value={fmtNum(summary.saves, locale)} />
            <Kpi label={o.rating} value={summary.review_count > 0 && avg ? `${avg.toFixed(2)} ★` : "—"}
              sub={summary.review_count > 0 ? fmtNum(summary.review_count, locale) : undefined} />
            <Kpi label={o.openReports} value={fmtNum(summary.open_reports, locale)} warn={summary.open_reports > 0} />
            <Kpi label={o.lastSignIn} value={summary.last_sign_in_at ? fmtDateTime(summary.last_sign_in_at, locale) : o.never} />
          </KpiGrid>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([["requests", summary.requests], ["bookings", summary.bookings], ["relationships", summary.relationships],
               ["reviews", summary.reviews]] as const).map(([key, data]) => (
              <div key={key}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{o[key]}</p>
                <Breakdown data={data ?? {}} locale={locale} />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{o.services}</p>
            {(summary.services ?? []).length === 0 ? <Note>—</Note> : (
              <ul className="grid gap-1.5 text-[13px]">
                {(summary.services ?? []).map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg px-3.5 py-2">
                    <span className="font-semibold">{s.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-ink-faint">
                        {s.price_unit === "free" ? t.coachProfile.services.free
                          : s.price_cents !== null ? formatPrice(s.price_cents, s.currency, locale) : t.coachProfile.services.onRequest}
                      </span>
                      <Pill tone={s.active ? "accent" : "neutral"}>{s.active ? o.serviceActive : o.serviceInactive}</Pill>
                      {s.bookable ? <Pill>{o.serviceBookable}</Pill> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section title={o.history} hint={o.historyHint}>
        {summary.history.length === 0 ? <Note>{o.historyNone}</Note> : (
          <Table empty={null} head={<><Th>{o.when}</Th><Th>{o.what}</Th><Th /></>}>
            {summary.history.map((h, i) => (
              <tr key={i} className="align-top" data-testid="admin-coach-history-row">
                <Td nowrap>{fmtDateTime(h.at, locale)}</Td>
                <Td>
                  <span className="font-semibold">{h.entity.replace(/_/g, " ")}</span>
                  {h.op ? <span className="text-ink-faint"> · {h.op.replace(/_/g, " ")}</span> : null}
                  {h.from || h.to ? <span className="block text-[12.5px]">{h.from ?? "—"} → {h.to ?? "—"}</span> : null}
                  {h.reason ? <span className="block text-[12.5px] text-ink-soft">“{h.reason}”</span> : null}
                </Td>
                <Td nowrap className="text-ink-faint">{h.actor ? fill(t.admin.coaches.ops.by, { name: h.actor }) : ""}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

/** /admin/coaches: profiles with a signal worth a look, worst first (admin_coach_attention). */
export async function AdminCoachAttention({ rows }: { rows: AttentionRow[] }) {
  const { t } = await getI18n();
  const a = t.admin.coaches.attention;
  return (
    <Section title={a.title} hint={a.hint}>
      {rows.length === 0 ? <Note>{a.none}</Note> : (
        <ul className="grid gap-1.5 text-[13.5px]" data-testid="admin-coach-attention">
          {rows.map((r) => (
            <li key={r.profile_id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-bg px-4 py-3">
              <span className="min-w-0">
                <span className="font-semibold">{r.display_name}</span>{" "}
                <span className="text-ink-faint">/coaches/{r.slug} · {t.admin.coaches.statuses[r.status as keyof typeof t.admin.coaches.statuses] ?? r.status}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {r.reasons.map((reason) => (
                    <Pill key={reason} tone={reason === "open_reports" || reason === "account_suspended" ? "risk" : "warn"}>
                      {a.reasons[reason] ?? reason}
                    </Pill>
                  ))}
                </span>
              </span>
              <Link href={`/admin/coaches/${r.profile_id}`} className="font-semibold text-accent-ink hover:underline">
                {t.admin.coaches.review} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
