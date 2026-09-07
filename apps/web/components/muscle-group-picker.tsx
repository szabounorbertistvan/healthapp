"use client";

// The 17 groups the imported library actually uses, most-populated first, so a
// day's stored muscle_groups always match exercises.primary_muscles and the
// picker's filter finds something for every choice.
export const MUSCLE_GROUPS = [
  "chest", "lats", "middle back", "lower back", "shoulders", "traps",
  "biceps", "triceps", "forearms", "abdominals", "quadriceps", "hamstrings",
  "glutes", "calves", "adductors", "abductors", "neck",
] as const;

export function MuscleGroupPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (groups: string[]) => void;
}) {
  const toggle = (group: string) =>
    onChange(
      selected.includes(group) ? selected.filter((g) => g !== group) : [...selected, group],
    );

  return (
    <div className="flex flex-wrap gap-1.5">
      {MUSCLE_GROUPS.map((group) => {
        const on = selected.includes(group);
        return (
          <button
            key={group}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(group)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize ${
              on ? "bg-accent text-white" : "bg-bg text-ink-soft hover:text-ink"
            }`}
          >
            {group}
          </button>
        );
      })}
    </div>
  );
}
