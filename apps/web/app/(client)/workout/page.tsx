import Link from "next/link";
import { getMyProgramDays, getMySessions } from "@/lib/client-data";
import { getMySoloProgramId } from "@/app/builder-actions";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

export default async function WorkoutPage() {
  const { t, locale } = await getI18n();
  const [days, sessions, soloProgramId] = await Promise.all([
    getMyProgramDays(),
    getMySessions(),
    getMySoloProgramId(),
  ]);

  // The builder is only a way back for a program the client built themselves.
  // getMyProgramDays hands back the coach's program whenever the coaching
  // relationship is active, so comparing ids is what keeps a coached client
  // from editing the plan they were given.
  const isMyOwnProgram = days.length > 0 && days[0].program_id === soloProgramId;

  return (
    <div>
      <PageTitle title={t.common.nav.training} />

      {days.length === 0 ? (
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
        <>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {days[0].program_name}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {days.map((day) => (
              <Link key={day.day_id} href={`/workout/${day.day_id}`}>
                <Card className="h-full transition hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold">{day.day_name}</p>
                    {day.logged.length > 0 ? (
                      <span className="rounded-md bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
                        {t.clientApp.workout.inProgress}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">
                    {fill(t.clientApp.workout.exercisesCount, { count: day.exercises.length })}
                  </p>
                  <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                    {day.exercises.map((e) => (
                      <li key={e.id} className="flex justify-between gap-2">
                        <span className="truncate">{e.exercise}</span>
                        <span className="shrink-0 tabular-nums text-ink-faint">
                          {e.sets}×{e.reps}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </Link>
            ))}

            {isMyOwnProgram ? (
              <Link
                href="/workout/build"
                className="flex h-full min-h-28 items-center justify-center gap-2 rounded-xl border border-dashed border-line p-4 text-sm font-semibold text-ink-faint transition hover:border-accent hover:text-accent-ink"
              >
                <span aria-hidden className="text-lg leading-none">+</span>
                {t.clientApp.workout.addAnotherDay}
              </Link>
            ) : null}
          </div>
        </>
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
                  <td className="px-4 py-3 font-semibold">{s.day_name}</td>
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
