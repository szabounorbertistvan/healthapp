import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminDailySeries, getAdminNutritionStats } from "@/lib/admin/data";
import { DAY_WINDOWS, daysOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { AdminHeader, Breakdown, DaysPicker, Kpi, KpiGrid, Pill, Section, Table, Td, Th, fmtNum } from "@/components/admin/ui";
import { DailyBars } from "@/components/admin/charts";

// Admin · nutrition observability: the food database's shape and gaps, and
// how logging is used. Read-only by design (see the intro copy).
export default async function AdminNutritionPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const days = daysOf(await searchParams);
  const [{ t, locale }, s, series] = await Promise.all([getI18n(), getAdminNutritionStats(days), getAdminDailySeries(days)]);
  const m = t.admin.nutrition;
  const c = t.admin.common;
  const n = (v: number | null | undefined) => fmtNum(v, locale);

  return (
    <div>
      <AdminHeader title={m.title} intro={m.intro}>
        <DaysPicker days={days} options={DAY_WINDOWS} href={(d) => `/admin/nutrition?days=${d}`} label={(d) => fill(c.days, { n: d })} />
        <Link href="/admin/foods" className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-[12.5px] font-bold text-accent-fg hover:opacity-90">{m.translate}</Link>
      </AdminHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title={m.foods}>
          <KpiGrid cols={3}>
            <Kpi label={m.foods} value={n(s.foods_total)} accent />
            <Kpi label={m.custom} value={n(s.foods_custom)} />
            <Kpi label={m.verified} value={n(s.foods_verified)} />
            <Kpi label={m.barcode} value={n(s.foods_with_barcode)} />
            <Kpi label={m.missingRo} value={n(s.foods_missing_ro)} warn={s.foods_missing_ro > 0} />
            <Kpi label={m.noKcal} value={n(s.foods_no_kcal)} warn={s.foods_no_kcal > 0} />
            <Kpi label={m.noMacros} value={n(s.foods_no_macros)} warn={s.foods_no_macros > 0} />
            <Kpi label={m.noPortions} value={n(s.foods_no_portions)} />
            <Kpi label={m.duplicates} value={n(s.foods_duplicate_names)} warn={s.foods_duplicate_names > 0} />
          </KpiGrid>
          <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.bySource}</h3>
          <Breakdown data={s.foods_by_source} locale={locale} />
        </Section>

        <Section title={m.logs}>
          <DailyBars title={m.chart} points={series.map((p) => ({ day: p.day, value: Number(p.food_logs) }))} locale={locale} accent />
          <div className="mt-3">
            <KpiGrid cols={3}>
              <Kpi label={m.logs} value={n(s.food_logs)} accent sub={`${n(s.food_logs_total)} ${m.logsTotal}`} />
              <Kpi label={m.activeUsers} value={n(s.active_users)} />
              <Kpi label={m.avgKcal} value={s.avg_kcal_per_day ? n(s.avg_kcal_per_day) : c.none} />
              <Kpi label={m.plans} value={n(s.plans_total)} sub={`${n(s.plans_published)} ${m.plansPublished} · ${n(s.plans_solo)} ${m.plansSolo}`} />
              <Kpi label={m.meals} value={n(s.meals_total)} />
              <Kpi label={m.favorites} value={n(s.favorites_total)} />
            </KpiGrid>
          </div>
        </Section>

        <Section title={m.byMethod}><Breakdown data={s.logs_by_method} labels={m.methods} locale={locale} /></Section>
        <Section title={m.bySlot}><Breakdown data={s.logs_by_slot} labels={m.slots} locale={locale} /></Section>

        <Section title={m.topFoods}>
          <Table empty={s.top_foods.length === 0 ? c.empty : null} head={<><Th>{m.th.name}</Th><Th className="text-right">{m.th.logs}</Th><Th className="text-right">{m.th.users}</Th></>}>
            {s.top_foods.map((f) => (
              <tr key={f.name}><Td className="font-semibold">{f.name}</Td><Td className="text-right tabular-nums">{n(f.logs)}</Td><Td className="text-right tabular-nums">{n(f.users)}</Td></tr>
            ))}
          </Table>
        </Section>

        <Section title={m.duplicateSamples}>
          <Table empty={s.duplicate_samples.length === 0 ? c.empty : null} head={<><Th>{m.th.name}</Th><Th>{m.th.brand}</Th><Th className="text-right">{m.th.count}</Th></>}>
            {s.duplicate_samples.map((d, i) => (
              <tr key={i}><Td className="font-semibold">{d.name}</Td><Td className="text-ink-soft">{d.brand || c.none}</Td><Td className="text-right tabular-nums">{n(d.count)}</Td></tr>
            ))}
          </Table>
        </Section>

        <Section title={m.incompleteSamples} className="lg:col-span-2">
          <Table empty={s.incomplete_samples.length === 0 ? c.empty : null} head={<>
            <Th>{m.th.name}</Th><Th>{m.th.source}</Th><Th className="text-right">{m.th.kcal}</Th><Th className="text-right">{m.th.protein}</Th><Th className="text-right">{m.th.carbs}</Th><Th className="text-right">{m.th.fat}</Th>
          </>}>
            {s.incomplete_samples.map((f) => (
              <tr key={f.id}>
                <Td className="font-semibold"><span title={f.id}>{f.name}</span></Td>
                <Td nowrap><Pill tone={f.source === "custom" ? "warn" : "neutral"}>{f.source}</Pill></Td>
                <Td className="text-right tabular-nums">{n(f.kcal)}</Td>
                <Td className="text-right tabular-nums">{n(f.protein)}</Td>
                <Td className="text-right tabular-nums">{n(f.carbs)}</Td>
                <Td className="text-right tabular-nums">{n(f.fat)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
    </div>
  );
}
