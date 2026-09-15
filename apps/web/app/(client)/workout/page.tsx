import Link from "next/link";
import { getMyProgramGroups, getMySessions, hasActiveCoach } from "@/lib/client-data";
import { getProfile } from "@/lib/data";
import { HaveACoach } from "@/components/solo-program-builder";
import { Card, EmptyState } from "@/components/ui";
import { WorkoutDayList } from "@/components/workout-day-list";
import { TrainingLoadBadge } from "@/components/training-load";
import { NavIcon } from "@/components/client-nav";
import { timeAgo } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export default async function WorkoutPage() {
  const { t, locale } = await getI18n();
  // getProfile is request-cached (the layout already read it); its sex picks the athlete on each card.
  const [groups, sessions, coached, profile] = await Promise.all([getMyProgramGroups(), getMySessions(), hasActiveCoach(), getProfile()]);

  // Every published program the client holds is listed — the coach's and their
  // own — so nothing they built disappears when a coach's program arrives.
  // The builder link appears when there is no program of their own yet.
  const hasOwn = groups.some((g) => g.is_own);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{t.common.nav.training}</h1>
        <div className="flex flex-wrap gap-2">
          <PillLink href="/exercises" icon="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 0-2 2zM4 4v18M8 8h6">
            {t.clientApp.library.title}
          </PillLink>
          {groups.length > 0 && !hasOwn && !coached ? (
            <PillLink href="/workout/build" icon="M12 5v14M5 12h14">
              {t.clientApp.builder.title}
            </PillLink>
          ) : null}
        </div>
      </div>

      {/* Days on the left, history on the right once the window is wide enough
          for both (2xl); below that the history follows the days. */}
      <div className="mt-5 grid gap-6 sm:mt-6 2xl:grid-cols-[minmax(0,1fr)_360px] 2xl:items-start 2xl:gap-8">
        <div className="space-y-4">
          {groups.length === 0 ? (
            <>
              <EmptyState plain title={t.clientApp.workout.noProgramTitle} hint={t.clientApp.workout.noProgramHint} />
              <Link
                href="/workout/build"
                className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-fg"
              >
                {t.clientApp.builder.title}
              </Link>
            </>
          ) : (
            <WorkoutDayList groups={groups} sex={profile?.sex ?? null} editable={!coached} />
          )}

          {/* A solo client can connect to a coach later — the same invitation code flow as onboarding. */}
          {!coached ? <HaveACoach /> : null}
        </div>

        <Card plain className="p-0 2xl:sticky 2xl:top-7">
          <h2 className="px-5 pb-2 pt-4 text-sm font-bold">{t.clientApp.workout.history}</h2>
          {sessions.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-ink-faint">{t.clientApp.workout.noSessions}</p>
          ) : (
            /* Rows, not a table: five px-4 columns need ~440px in Romanian,
               which on a 375px phone meant a sideways-scrolling page. Same
               name + subline shape WorkoutHistory uses on the day page. */
            <ul className="text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 border-t border-line/60 px-5 py-3">
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
          )}
        </Card>
      </div>
    </div>
  );
}

/** Secondary page action: a pill on the surface colour, icon + label. */
function PillLink({ href, icon, children }: { href: string; icon: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-soft hover:text-ink sm:h-10 sm:px-4 sm:text-[13px]"
    >
      <NavIcon d={icon} className="h-[17px] w-[17px]" />
      {children}
    </Link>
  );
}
