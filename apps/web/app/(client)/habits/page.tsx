import { getMyHabits } from "@/lib/client-data";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { HabitTicks } from "@/components/habit-ticks";
import { AddHabitForm } from "@/components/add-habit-form";

export default async function HabitsPage() {
  const habits = await getMyHabits();
  const ticks = habits.reduce((sum, h) => sum + h.done_this_week, 0);
  const scheduled = habits.reduce((sum, h) => sum + h.target_per_week, 0);

  return (
    <div className="space-y-4">
      <PageTitle title="Habits">
        <span className="text-xs tabular-nums text-ink-faint">
          {ticks}/{scheduled} this week
        </span>
      </PageTitle>

      {habits.length === 0 ? (
        <EmptyState title="No habits yet" hint="Add one below — habits are 15% of your weekly score." />
      ) : (
        <Card>
          <HabitTicks habits={habits} />
        </Card>
      )}

      <AddHabitForm />
    </div>
  );
}
