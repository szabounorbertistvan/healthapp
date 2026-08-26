import { getMyHabits } from "@/lib/client-data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { HabitTicks } from "@/components/habit-ticks";
import { AddHabitForm } from "@/components/add-habit-form";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n";

export default async function HabitsPage() {
  const { t } = await getI18n();
  const habits = await getMyHabits();
  const ticks = habits.reduce((sum, h) => sum + h.done_this_week, 0);
  const scheduled = habits.reduce((sum, h) => sum + h.target_per_week, 0);

  return (
    <div className="space-y-4">
      <PageTitle title={t.common.nav.habits}>
        <span className="text-xs tabular-nums text-ink-faint">
          {fill(t.clientApp.habits.thisWeek, { done: ticks, target: scheduled })}
        </span>
      </PageTitle>

      {habits.length === 0 ? (
        <EmptyState
          title={t.clientApp.habits.noHabitsTitle}
          hint={t.clientApp.habits.noHabitsHint}
        />
      ) : (
        <Card>
          <HabitTicks habits={habits} />
        </Card>
      )}

      <AddHabitForm />
    </div>
  );
}
