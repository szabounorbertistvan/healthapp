import Link from "next/link";
import { getMyProgramGroups, getMySessions } from "@/lib/client-data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { WorkoutDayList } from "@/components/workout-day-list";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export default async function WorkoutPage() {
  const { t, locale } = await getI18n();
  const [groups, sessions] = await Promise.all([getMyProgramGroups(), getMySessions()]);

  // Every published program the client holds is listed — the coach's and their
  // own — so nothing they built disappears when a coach's program arrives.
  // The builder link appears when there is no program of their own yet.
  const hasOwn = groups.some((g) => g.is_own);

  return (
    <div>
      <PageTitle title={t.common.nav.training}>
        {groups.length > 0 && !hasOwn ? (
          <Link href="/workout/build" className="text-xs font-semibold text-accent-ink hover:underline">
            {t.clientApp.builder.title}
          </Link>
        ) : null}
      </PageTitle>

      {groups.length === 0 ? (
        <>
          <EmptyState
            title={t.clientApp.workout.noProgramTitle}
            hint={t.clientApp.workout.noProgramHint}
          />
          <Link
            href="/workout/build"
            className="mt-3 inline-block rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg"
          >
            {t.clientApp.builder.title}
          </Link>
        </>
      ) : (
        <WorkoutDayList groups={groups} />
      )}

      <h2 className="mb-3 mt-8 text-sm font-bold">{t.clientApp.workout.history}</h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-ink-faint">{t.clientApp.workout.noSessions}</p>
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3 font-semibold">{t.clientApp.workout.session}</th>
                <th className="px-4 py-3 font-semibold">{t.clientApp.workout.when}</th>
                <th className="px-4 py-3 text-right font-semibold">{t.clientApp.workout.sets}</th>
                <th className="px-4 py-3 text-right font-semibold">{t.clientApp.workout.volume}</th>
                <th className="px-4 py-3 text-right font-semibold">{t.clientApp.workout.prs}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold">
                    {s.day_id ? (
                      <Link href={`/workout/${s.day_id}`} className="hover:text-accent-ink">
                        {s.day_name}
                      </Link>
                    ) : (
                      s.day_name
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{timeAgo(s.at, locale)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.sets}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.volume_kg.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB")} kg
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.prs > 0 ? (
                      <span className="font-semibold text-accent-ink">{s.prs}</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
