"use client";
import { useEffect, useState, useTransition } from "react";
import { exerciseRef, type ExerciseSummary } from "@buddygym/shared";
import { searchExerciseLibrary } from "@/app/library-actions";

type Props = {
  muscles: string[];
  equipment: string[];
  /** Called with the exercise the coach picked. Omit to browse read-only. */
  onPick?: (exercise: ExerciseSummary) => void;
  pendingLabel?: string;
};

export function ExercisePicker({ muscles, equipment, onPick, pendingLabel }: Props) {
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState("");
  const [gear, setGear] = useState("");
  const [results, setResults] = useState<ExerciseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);

  // Debounced: the coach types faster than a round-trip, and the library is
  // 873 rows on the server rather than in this bundle.
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await searchExerciseLibrary({ q, muscle, equipment: gear });
        setResults(found.results);
        setTotal(found.total);
        setLoading(false);
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [q, muscle, gear]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search exercises…"
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <div className="flex flex-wrap gap-2">
        <Facet label="All muscles" options={muscles} value={muscle} onChange={setMuscle} />
        <Facet label="All equipment" options={equipment} value={gear} onChange={setGear} />
        {muscle || gear || q ? (
          <button
            onClick={() => {
              setQ("");
              setMuscle("");
              setGear("");
            }}
            className="rounded-lg px-2 py-1 text-xs text-ink-soft underline"
          >
            clear
          </button>
        ) : null}
      </div>

      <p className="text-xs text-ink-faint">
        {loading ? "Searching…" : `${total} exercise${total === 1 ? "" : "s"}`}
        {total > results.length ? ` · showing first ${results.length}` : ""}
      </p>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {results.map((exercise) => (
          <li
            key={exercise.external_id}
            className="rounded-lg border border-line bg-bg p-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{exercise.name_en}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {exercise.primary_muscles.join(", ") || "—"}
                  {exercise.equipment ? ` · ${exercise.equipment}` : ""}
                  {exercise.level ? ` · ${exercise.level}` : ""}
                </p>
              </div>
              {onPick ? (
                <button
                  onClick={() => onPick(exercise)}
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:border-accent hover:text-accent-ink"
                >
                  {pendingLabel ?? "Add"}
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {!loading && results.length === 0 ? (
          <li className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-soft">
            Nothing matches. Custom exercises land in Sprint 3 too.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Facet({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-line bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export { exerciseRef };
