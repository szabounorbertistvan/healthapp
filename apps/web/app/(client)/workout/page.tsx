import Link from "next/link";
import { getMyProgramGroups, getMySessions, hasActiveCoach } from "@/lib/client-data";
import { HaveACoach } from "@/components/solo-program-builder";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { WorkoutDayList } from "@/components/workout-day-list";
import { TrainingLoadBadge } from "@/components/training-load";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export default async function WorkoutPage() {
  const { t, locale } = await getI18n();
  const [groups, sessions, coached] = await Promise.all([getMyProgramGroups(), getMySessions(), hasActiveCoach()]);

  // Every published program the client holds is listed — the coach's and their
  // own — so nothing they built disappears when a coach's program arrives.
  // The builder link appears when there is no program of their own yet.
  const hasOwn = groups.some((g) => g.is_own);

  return (
    <div>
      <PageTitle title={t.common.nav.training}>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold">
          <Link href="/exercises" className="text-accent-ink hover:underline">
            {t.clientApp.library.title}
          </Link>
          {groups.length > 0 && !hasOwn && !coached ? (
            <Link href="/workout/build" className="text-accent-ink hover:underline">
              {t.clientApp.builder.title}
            </Link>
          ) : null}
        </span>
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
        <WorkoutDayList groups={groups} editable={!coached} />
      )}

      {/* A solo client can connect to a coach later — the same invitation code flow as onboarding. */}
      {!coached ? <div className="mt-4"><HaveACoach /></div> : null}

      <h2 className="mb-3 mt-8 text-sm font-bold">{t.clientApp.workout.history}</h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-ink-faint">{t.clientApp.workout.noSessions}</p>
      ) : (
        <Card className="p-0">
          {/* Rows, not a table: five px-4 columns need ~440px in Romanian,
              which on a 375px phone meant a sideways-scrolling page. Same
              name + subline shape WorkoutHistory uses on the day page. */}
          <ul className="text-sm">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {s.day_id ? (
                      <Link href={`/workout/${s.day_id}`} className="hover:text-accent-ink">
                        {s.day_name}
                      </Link>
                    ) : (
                      s.day_name
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">{timeAgo(s.at, locale)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right text-xs tabular-nums text-ink-soft">
                  <p>
                    {s.load.duration_min !== null ? `${s.load.duration_min} min · ` : ""}
                    {s.sets} {t.clientApp.workoutDay.sets} ·{" "}
                    {s.volume_kg.toLocaleString(locale === "ro" ? "ro-RO" : "en-GB")} kg
                    {s.prs > 0 ? (
                      <>
                        {" · "}
                        <span className="font-semibold text-accent-ink">
                          {s.prs} {t.clientApp.workoutDay.prs}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <TrainingLoadBadge load={s.load} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
