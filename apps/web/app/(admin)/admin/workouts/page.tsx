import { requireAdmin } from "@/lib/admin/guard";
import { getAdminDailySeries, getAdminWorkoutStats } from "@/lib/admin/data";
import { DAY_WINDOWS, daysOf, type Search } from "@/lib/admin/params";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";
import { AdminHeader, Breakdown, DaysPicker, Kpi, KpiGrid, Note, Section, Table, Td, Th, UserCell, fmtNum } from "@/components/admin/ui";
import { DailyBars, DailyLines } from "@/components/admin/charts";

// Admin · training analytics over a window (7/14/30/90 days).
export default async function AdminWorkoutsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const days = daysOf(await searchParams);
  const [{ t, locale }, s, series] = await Promise.all([getI18n(), getAdminWorkoutStats(days), getAdminDailySeries(days)]);
  const m = t.admin.workouts;
  const c = t.admin.common;
  const n = (v: number | null | undefined) => fmtNum(v, locale);
  const pts = (key: "workouts" | "sets" | "active_users") => series.map((p) => ({ day: p.day, value: Number(p[key]) }));
  const hours = Object.fromEntries(s.by_hour.map((h) => [`${String(h.hour).padStart(2, "0")}:00`, h.sessions]));

  return (
    <div>
      <AdminHeader title={m.title} intro={m.filtersHint}>
        <DaysPicker days={days} options={DAY_WINDOWS} href={(d) => `/admin/workouts?days=${d}`} label={(d) => fill(c.days, { n: d })} />
      </AdminHeader>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DailyBars title={m.charts.workouts} points={pts("workouts")} locale={locale} accent />
        <DailyBars title={m.charts.sets} points={pts("sets")} locale={locale} />
        <DailyLines title={m.charts.active} series={[{ label: m.charts.active, points: pts("active_users"), tone: "accent" }]} locale={locale} />
      </div>
      <Section title={fill(c.days, { n: s.days })} className="mt-4">
        <KpiGrid cols={6}>
          <Kpi label={m.sessions} value={n(s.sessions)} />
          <Kpi label={m.completed} value={n(s.completed)} accent />
          <Kpi label={m.abandoned} value={n(s.abandoned)} warn={s.abandoned > 0} sub={m.abandonedHint} />
          <Kpi label={m.inProgress} value={n(s.in_progress)} />
          <Kpi label={m.sets} value={n(s.sets)} />
          <Kpi label={m.prs} value={n(s.prs)} />
          <Kpi label={m.exercises} value={n(s.exercises_logged)} />
          <Kpi label={m.activeUsers} value={n(s.active_users)} />
          <Kpi label={m.avgDuration} value={s.avg_duration_min ? `${n(s.avg_duration_min)} ${c.min}` : c.none} />
          <Kpi label={m.avgSets} value={s.avg_sets_per_session ? n(s.avg_sets_per_session) : c.none} />
          <Kpi label={m.streakToday} value={n(s.streak_users_today)} />
          <Kpi label={m.programs} value={n(s.programs_total)} sub={`${n(s.programs_published)} ${m.programsPublished} · ${n(s.programs_created)} ${m.programsCreated} · ${n(s.programs_solo)} ${m.programsSolo}`} />
        </KpiGrid>
      </Section>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Section title={m.topExercises} className="xl:col-span-1">
          <Table empty={s.top_exercises.length === 0 ? c.empty : null} head={<><Th>{m.th.exercise}</Th><Th className="text-right">{m.th.sets}</Th><Th className="text-right">{m.th.users}</Th></>}>
            {s.top_exercises.map((e) => (
              <tr key={e.id}><Td className="font-semibold">{e.name}</Td><Td className="text-right tabular-nums">{n(e.sets)}</Td><Td className="text-right tabular-nums">{n(e.users)}</Td></tr>
            ))}
          </Table>
        </Section>
        <Section title={m.topUsers} className="xl:col-span-1">
          <Table empty={s.top_users.length === 0 ? c.empty : null} head={<><Th>{m.th.user}</Th><Th className="text-right">{m.th.workouts}</Th><Th className="text-right">{m.th.sets}</Th></>}>
            {s.top_users.map((u) => (
              <tr key={u.id}><Td><UserCell id={u.id} name={u.full_name} username={u.username} /></Td><Td className="text-right tabular-nums">{n(u.workouts)}</Td><Td className="text-right tabular-nums">{n(u.sets)}</Td></tr>
            ))}
          </Table>
        </Section>
        <Section title={m.load}><Breakdown data={s.load_distribution} labels={m.loadBands} locale={locale} /></Section>
        <Section title={m.byHour}><Breakdown data={hours} locale={locale} /></Section>
      </div>
      <Note>{m.filtersHint}</Note>
    </div>
  );
}
