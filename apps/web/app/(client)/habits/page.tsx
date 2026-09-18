import { getMyHabits } from "@/lib/client-data";
import { Card, EmptyState } from "@/components/ui";
import { HabitTicks } from "@/components/habit-ticks";
import { AddHabitForm } from "@/components/add-habit-form";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

/**
 * The habits screen: the list of what is being tracked on the left (tick, read
 * what it is for, remove), the ways to add one on the right. Two columns once
 * there is room, one on a phone.
 */
export default async function HabitsPage() {
  const { t } = await getI18n();
  const habits = await getMyHabits();
  const ticks = habits.reduce((sum, h) => sum + h.done_this_week, 0);
  const scheduled = habits.reduce((sum, h) => sum + h.target_per_week, 0);

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
          {t.common.nav.habits}
        </h1>
        <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold tabular-nums text-ink-soft">
          {fill(t.clientApp.habits.thisWeek, { done: ticks, target: scheduled })}
        </span>
      </header>

      <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:mt-6 lg:grid-cols-2 lg:gap-6">
        {habits.length === 0 ? (
          <EmptyState
            plain
            title={t.clientApp.habits.noHabitsTitle}
            hint={t.clientApp.habits.noHabitsHint}
          />
        ) : (
          <Card plain>
            <HabitTicks habits={habits} removable />
          </Card>
        )}

        <AddHabitForm existingNames={habits.map((h) => h.name)} />
      </div>
    </div>
  );
}
