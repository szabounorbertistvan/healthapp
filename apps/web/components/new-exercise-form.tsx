"use client";
import { useState, useTransition } from "react";
import type { ExerciseSummary } from "@healthapp/shared";
import { createCustomExercise } from "@/app/library-actions";
import { useI18n } from "@/lib/i18n/client";

const CATEGORIES = ["strength", "stretching", "cardio", "plyometrics"] as const;
const LEVELS = ["beginner", "intermediate", "expert"] as const;
const MECHANICS = ["compound", "isolation"] as const;

const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
const labelClass = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";

/**
 * Create an exercise the library does not have. Lives inside the picker so it
 * opens exactly where the search came up empty. On success the new row is
 * handed back so the caller can add it to the day in the same motion.
 */
export function NewExerciseForm({
  muscles,
  equipment,
  initialName = "",
  initialMuscle = "",
  canAdd,
  onCreated,
  onCancel,
}: {
  muscles: string[];
  equipment: string[];
  initialName?: string;
  initialMuscle?: string;
  /** True when the picker has an onPick — the primary button then also adds it. */
  canAdd: boolean;
  onCreated: (exercise: ExerciseSummary) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.newExerciseForm;
  const [name, setName] = useState(initialName);
  const [primary, setPrimary] = useState(initialMuscle);
  const [secondary, setSecondary] = useState<string[]>([]);
  const [gear, setGear] = useState("");
  const [category, setCategory] = useState<string>("strength");
  const [level, setLevel] = useState<string>("");
  const [mechanic, setMechanic] = useState<string>("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = name.trim().length >= 2 && primary !== "";

  function toggleSecondary(muscle: string) {
    setSecondary((prev) =>
      prev.includes(muscle) ? prev.filter((x) => x !== muscle) : [...prev, muscle],
    );
  }

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      setError(null);
      const result = await createCustomExercise({
        name,
        primaryMuscle: primary,
        secondaryMuscles: secondary,
        equipment: gear,
        category,
        level: level || null,
        mechanic: mechanic || null,
        instructions,
      });
      if (!result.ok) {
        setError(result.message || m.couldNotCreate);
        return;
      }
      onCreated(result.exercise);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-accent bg-surface p-3">
      <div>
        <p className="text-sm font-bold">{m.title}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{m.body}</p>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>{m.name}</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={m.namePlaceholder}
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{m.primaryMuscle}</span>
          <select value={primary} onChange={(e) => setPrimary(e.target.value)} className={inputClass}>
            <option value="">—</option>
            {muscles.map((muscle) => (
              <option key={muscle} value={muscle}>{muscle}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{m.equipment}</span>
          <input
            list="new-exercise-equipment"
            value={gear}
            onChange={(e) => setGear(e.target.value)}
            placeholder={m.equipmentPlaceholder}
            className={inputClass}
          />
          <datalist id="new-exercise-equipment">
            {equipment.map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>
      </div>

      <div>
        <p className={labelClass}>{m.secondaryMuscles}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {muscles
            .filter((muscle) => muscle !== primary)
            .map((muscle) => {
              const on = secondary.includes(muscle);
              return (
                <button
                  key={muscle}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSecondary(muscle)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold capitalize ${
                    on ? "bg-accent text-accent-fg" : "bg-bg text-ink-soft hover:text-ink"
                  }`}
                >
                  {muscle}
                </button>
              );
            })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{m.category}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{m.categories[c]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{m.level}</span>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
            <option value="">—</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{m.levels[l]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{m.mechanic}</span>
          <select value={mechanic} onChange={(e) => setMechanic(e.target.value)} className={inputClass}>
            <option value="">—</option>
            {MECHANICS.map((x) => (
              <option key={x} value={x}>{m.mechanics[x]}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelClass}>{m.instructions}</span>
        <textarea
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={m.instructionsPlaceholder}
          className={inputClass}
        />
      </label>

      {error ? <p className="text-sm font-semibold text-risk">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !valid}
          onClick={submit}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {pending ? "…" : canAdd ? m.saveAndAdd : m.save}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-faint hover:text-ink"
        >
          {t.common.actions.cancel}
        </button>
      </div>
    </div>
  );
}
