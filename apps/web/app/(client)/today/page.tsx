import Link from "next/link";
import { getToday } from "@/lib/client-data";
import { Card, EmptyState, PageTitle, SignalBadge } from "@/components/ui";
import { AdherenceMeter, MacroPanel } from "@/components/client-ui";
import { HabitTicks } from "@/components/habit-ticks";
import { timeAgo } from "@/lib/format";

export default async function TodayPage() {
  const today = await getToday();
  if (!today) {
    return <EmptyState title="Not signed in" hint="Sign in to see your week." />;
  }

  const {
    adherence, next_workout: next, nutrition, habits, check_in: checkIn,
    sessions_done: done, sessions_planned: planned, streak_days: streak, last_activity: last,
  } = today;

  return (
    <div className="space-y-4">
      <PageTitle title={`Hi, ${today.full_name.split(" ")[0]}`}>
        <SignalBadge signal={adherence.signal} />
      </PageTitle>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <AdherenceMeter overall={adherence.overall} reason={adherence.reason} />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Streak</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {streak}
              <span className="ml-1 text-sm font-medium text-ink-faint">
                {streak === 1 ? "day" : "days"}
              </span>
            </p>
          </Card>
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Workouts</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {done}
              <span className="text-sm font-medium text-ink-faint"> / {planned || 3}</span>
            </p>
          </Card>
        </div>
      </div>

      {adherence.signal === "at_risk" ? (
        <Card className="border-risk-soft bg-risk-soft">
          <p className="text-sm font-semibold text-risk">Let us get you moving again</p>
          <p className="mt-1 text-xs leading-snug text-risk">
            Last activity {timeAgo(last)}. One logged set or one meal is enough to restart the week —
            your coach sees the same signal you do.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Next workout
          </p>
          {next ? (
            <>
              <p className="font-bold">{next.day_name}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {next.program_name} · {next.exercises.length} exercises
              </p>
              <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                {next.exercises.slice(0, 3).map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="truncate">{e.exercise}</span>
                    <span className="shrink-0 tabular-nums text-ink-faint">
                      {e.sets}×{e.reps}
                    </span>
                  </li>
                ))}
                {next.exercises.length > 3 ? (
                  <li className="text-xs text-ink-faint">+{next.exercises.length - 3} more</li>
                ) : null}
              </ul>
              <Link
                href={`/workout/${next.day_id}`}
                className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Start workout
              </Link>
            </>
          ) : (
            <p className="text-sm text-ink-soft">
              No published program yet — your coach assigns one from their workspace.
            </p>
          )}
        </Card>

        <div className="space-y-4">
          <MacroPanel
            totals={nutrition.totals}
            target={nutrition.target}
            title={nutrition.plan_name ?? "Nutrition"}
          />
          <Link
            href="/food"
            className="inline-block rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-accent"
          >
            Log food
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Habits today
          </p>
          {habits.length === 0 ? (
            <p className="text-sm text-ink-soft">No habits yet.</p>
          ) : (
            <HabitTicks habits={habits} />
          )}
        </Card>

        <Card>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Weekly check-in
          </p>
          {checkIn.submitted ? (
            <p className="text-sm text-ink-soft">Submitted for this week. Your coach will review it.</p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                Not submitted yet — it is 15% of your weekly score.
              </p>
              <Link
                href="/check-in"
                className="mt-3 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Check in
              </Link>
            </>
          )}
          {checkIn.last?.coach_feedback ? (
            <div className="mt-4 rounded-lg bg-accent-soft p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                From your coach
              </p>
              <p className="mt-1 text-sm leading-snug text-ink-soft">{checkIn.last.coach_feedback}</p>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
