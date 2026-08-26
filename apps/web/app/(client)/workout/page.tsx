import Link from "next/link";
import { getMyProgramDays, getMySessions } from "@/lib/client-data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { timeAgo } from "@/lib/format";

export default async function WorkoutPage() {
  const [days, sessions] = await Promise.all([getMyProgramDays(), getMySessions()]);

  return (
    <div>
      <PageTitle title="Training" />

      {days.length === 0 ? (
        <EmptyState
          title="No program assigned"
          hint="Your coach builds one in their workspace — it appears here the moment it is published."
        />
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
                        in progress
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-ink-faint">{day.exercises.length} exercises</p>
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
          </div>
        </>
      )}

      <h2 className="mb-3 mt-8 text-sm font-bold">History</h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-ink-faint">No completed sessions yet.</p>
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3 font-semibold">Session</th>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 text-right font-semibold">Sets</th>
                <th className="px-4 py-3 text-right font-semibold">Volume</th>
                <th className="px-4 py-3 text-right font-semibold">PRs</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold">{s.day_name}</td>
                  <td className="px-4 py-3 text-ink-soft">{timeAgo(s.at)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.sets}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.volume_kg.toLocaleString()} kg
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
