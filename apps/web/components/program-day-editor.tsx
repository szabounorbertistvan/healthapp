"use client";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  DEFAULT_TARGETS, circuitLabel, circuitSegments, exerciseRef, nextCircuit, parseDecimal,
  type ExerciseSummary, type ExerciseTargets,
} from "@healthapp/shared";
import {
  addProgramExercise, moveProgramDay, moveProgramExercise, removeProgramExercise, renameProgramDay,
  replaceProgramExercise, setExerciseCircuit, updateProgramExercise,
} from "@/app/builder-actions";
import { ExercisePicker } from "@/components/exercise-picker";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import type { ProgramDetail, ProgramExerciseRow } from "@/lib/types";

type Run = (action: () => Promise<{ ok: boolean; message?: string }>) => void;

const cell = "w-full min-w-0 rounded border border-line bg-bg px-1.5 py-1.5 text-sm tabular-nums outline-none focus:border-accent";
const label = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";

/**
 * One training day as an editor — the same card for the coach's builder and
 * the solo client's: rename the day, move it, and for every prescribed
 * exercise edit sets / reps / kg / RIR (or RPE) / rest, reorder, link it into
 * a circuit, swap the exercise or remove it. Adding an exercise asks for its
 * prescription before it lands. A card list, not a table, so a phone can
 * edit it. Whether the caller may edit at all is decided server-side
 * (can_edit_program); the surface simply is not rendered for those who
 * cannot.
 */
export function ProgramDayEditor({
  program,
  day,
  index,
  total,
  muscles,
  equipment,
  run,
  pending,
  actions,
}: {
  program: ProgramDetail;
  day: ProgramDetail["days"][number];
  index: number;
  total: number;
  muscles: string[];
  equipment: string[];
  run: Run;
  pending: boolean;
  /** Extra buttons for the day header (duplicate, delete). */
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.programBuilder;
  const [picking, setPicking] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ExerciseSummary | null>(null);
  const intensityLabel = program.intensity_mode === "rpe" ? "RPE" : "RIR";
  const segments = circuitSegments(day.exercises);
  const circuits = [...new Set(day.exercises.map((e) => e.circuit).filter((c): c is number => c !== null))].sort((a, b) => a - b);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <DayName name={day.name} disabled={pending} onSave={(name) => run(() => renameProgramDay(program.id, day.id, name))} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            disabled={pending || index === 0}
            onClick={() => run(() => moveProgramDay(program.id, day.id, -1))}
            aria-label={m.moveUp}
            title={m.moveUp}
            className="min-h-9 rounded-lg border border-line px-2.5 hover:border-accent disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={pending || index >= total - 1}
            onClick={() => run(() => moveProgramDay(program.id, day.id, 1))}
            aria-label={m.moveDown}
            title={m.moveDown}
            className="min-h-9 rounded-lg border border-line px-2.5 hover:border-accent disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => { setPicking((v) => !v); setReplacing(null); setCandidate(null); }}
            className="min-h-9 rounded-lg border border-line px-2.5 font-semibold hover:border-accent hover:text-accent-ink"
          >
            {picking ? m.closeLibrary : m.addExercise}
          </button>
          {actions}
        </div>
      </div>

      {day.exercises.length === 0 && !picking ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-faint">{m.noExercises}</p>
      ) : null}

      <div className="space-y-2">
        {segments.map((seg, si) => (
          <div
            key={seg.circuit ?? `solo-${si}`}
            className={seg.circuit !== null ? "rounded-lg border-l-4 border-accent bg-accent-soft/40 p-2 pl-3" : ""}
          >
            {seg.label ? (
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                🔗 {fill(m.circuitName, { label: seg.label })} · {fill(m.circuitRounds, { n: seg.exercises.length })}
              </p>
            ) : null}
            <div className="space-y-2">
              {seg.exercises.map((row) => (
                <ExerciseCard
                  key={row.id}
                  row={row}
                  intensityLabel={intensityLabel}
                  circuits={circuits}
                  first={row.position === Math.min(...day.exercises.map((e) => e.position))}
                  last={row.position === Math.max(...day.exercises.map((e) => e.position))}
                  disabled={pending}
                  replacing={replacing === row.id}
                  onSave={(values) => run(() => updateProgramExercise({ programId: program.id, exerciseRowId: row.id, ...values }))}
                  onMove={(dir) => run(() => moveProgramExercise(program.id, day.id, row.id, dir))}
                  onCircuit={(c) => run(() => setExerciseCircuit(program.id, row.id, c))}
                  onNewCircuit={() => run(() => setExerciseCircuit(program.id, row.id, nextCircuit(day.exercises)))}
                  onReplace={() => { setReplacing(replacing === row.id ? null : row.id); setPicking(false); setCandidate(null); }}
                  onRemove={() => run(() => removeProgramExercise(program.id, row.id))}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {replacing ? (
        <div className="mt-3 flex h-[26rem] flex-col rounded-lg border border-accent bg-bg p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{m.changeExercise}</p>
          <ExercisePicker
            muscles={muscles}
            equipment={equipment}
            pendingLabel={m.useThis}
            onPick={(exercise) => {
              const id = exercise.id ?? exerciseRef(exercise);
              setReplacing(null);
              run(() => replaceProgramExercise(program.id, replacing, id));
            }}
          />
        </div>
      ) : null}

      {picking ? (
        candidate ? (
          <AddExerciseForm
            exercise={candidate}
            intensityLabel={intensityLabel}
            circuits={circuits}
            nextCircuit={nextCircuit(day.exercises)}
            disabled={pending}
            onCancel={() => setCandidate(null)}
            onAdd={(targets, circuit) => {
              setCandidate(null);
              run(() =>
                addProgramExercise({
                  programId: program.id,
                  dayId: day.id,
                  exerciseId: candidate.id ?? exerciseRef(candidate),
                  exerciseName: candidate.name_en,
                  targets,
                  circuit,
                }),
              );
            }}
          />
        ) : (
          <div className="mt-3 flex h-[26rem] flex-col rounded-lg border border-line bg-bg p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{fill(m.addTo, { name: day.name })}</p>
            <ExercisePicker
              muscles={muscles}
              equipment={equipment}
              initialMuscle={day.muscle_groups[0] ?? ""}
              pendingLabel={m.choose}
              onPick={(exercise) => setCandidate(exercise)}
            />
          </div>
        )
      ) : null}
    </Card>
  );
}

/** The day's name: text until tapped, then an input; Enter or blur saves. */
function DayName({ name, disabled, onSave }: { name: string; disabled: boolean; onSave: (name: string) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  function commit() {
    setEditing(false);
    if (value.trim() && value.trim() !== name) onSave(value);
    else setValue(name);
  }
  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setValue(name); setEditing(true); }}
        title={t.coachWidgets.programBuilder.renameDay}
        className="min-w-0 truncate rounded px-1 text-left font-bold hover:bg-bg"
      >
        {name} <span className="text-xs font-normal text-ink-faint">✎</span>
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setValue(name); setEditing(false); } }}
      aria-label={t.coachWidgets.programBuilder.renameDay}
      className="min-w-0 flex-1 rounded-lg border border-accent bg-bg px-2 py-1 font-bold outline-none"
    />
  );
}

function ExerciseCard({
  row, intensityLabel, circuits, first, last, disabled, replacing,
  onSave, onMove, onCircuit, onNewCircuit, onReplace, onRemove,
}: {
  row: ProgramExerciseRow;
  intensityLabel: string;
  circuits: number[];
  first: boolean;
  last: boolean;
  disabled: boolean;
  replacing: boolean;
  onSave: (values: ExerciseTargets) => void;
  onMove: (direction: -1 | 1) => void;
  onCircuit: (circuit: number | null) => void;
  onNewCircuit: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.programBuilder;
  const [values, setValues] = useState<ExerciseTargets>({
    target_sets: row.sets, target_reps: row.reps, target_weight_kg: row.weight_kg, target_rpe: row.rpe_value, rest_seconds: row.rest_seconds,
  });
  // The blur that follows a change can land in the same React batch; the ref is always current.
  const latest = useRef(values);
  function change(next: ExerciseTargets) { latest.current = next; setValues(next); }
  function commit() { onSave(latest.current); }
  function enter(e: KeyboardEvent<HTMLInputElement>) { if (e.key === "Enter") e.currentTarget.blur(); }
  const num = (raw: string) => parseDecimal(raw);

  return (
    <div className={`rounded-lg border bg-surface p-2.5 ${replacing ? "border-accent" : "border-line"}`}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onReplace} disabled={disabled} title={m.changeExercise} className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-accent-ink">
          {row.exercise} <span className="text-xs font-normal text-ink-faint">✎</span>
        </button>
        <button type="button" disabled={disabled || first} onClick={() => onMove(-1)} aria-label={m.moveUp} className="min-h-8 rounded px-2 text-xs text-ink-soft hover:bg-bg disabled:opacity-30">↑</button>
        <button type="button" disabled={disabled || last} onClick={() => onMove(1)} aria-label={m.moveDown} className="min-h-8 rounded px-2 text-xs text-ink-soft hover:bg-bg disabled:opacity-30">↓</button>
        <button type="button" onClick={onRemove} disabled={disabled} title={m.removeExercise} aria-label={m.removeExercise} className="min-h-8 rounded px-2 text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50">×</button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <label className="flex flex-col gap-0.5"><span className={label}>{m.colSets}</span>
          <input type="number" min={1} max={20} inputMode="numeric" value={values.target_sets} disabled={disabled} onChange={(e) => change({ ...latest.current, target_sets: Number(e.target.value) })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-0.5"><span className={label}>{m.colReps}</span>
          <input value={values.target_reps} disabled={disabled} placeholder="8-10" onChange={(e) => change({ ...latest.current, target_reps: e.target.value })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-0.5"><span className={label}>{intensityLabel}</span>
          <input inputMode="decimal" value={values.target_rpe ?? ""} disabled={disabled} onChange={(e) => change({ ...latest.current, target_rpe: num(e.target.value) })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-0.5"><span className={label}>{m.colKg}</span>
          <input inputMode="decimal" value={values.target_weight_kg ?? ""} disabled={disabled} onChange={(e) => change({ ...latest.current, target_weight_kg: num(e.target.value) })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-0.5"><span className={label}>{m.colRest}</span>
          <input type="number" step={15} min={0} max={600} inputMode="numeric" value={values.rest_seconds ?? ""} disabled={disabled} onChange={(e) => change({ ...latest.current, rest_seconds: e.target.value === "" ? null : Number(e.target.value) })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-0.5"><span className={label}>{m.circuit}</span>
          <select
            value={row.circuit ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "new") onNewCircuit();
              else onCircuit(v === "" ? null : Number(v));
            }}
            className={cell}
          >
            <option value="">{m.noCircuit}</option>
            {circuits.map((c) => <option key={c} value={c}>{circuitLabel(c)}</option>)}
            <option value="new">{m.newCircuit}</option>
          </select></label>
      </div>
    </div>
  );
}

/** The step between picking an exercise and adding it: its prescription, and the circuit it joins. */
function AddExerciseForm({
  exercise, intensityLabel, circuits, nextCircuit: next, disabled, onAdd, onCancel,
}: {
  exercise: ExerciseSummary;
  intensityLabel: string;
  circuits: number[];
  nextCircuit: number;
  disabled: boolean;
  onAdd: (targets: ExerciseTargets, circuit: number | null) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const m = t.coachWidgets.programBuilder;
  const [sets, setSets] = useState(String(DEFAULT_TARGETS.target_sets));
  const [reps, setReps] = useState(DEFAULT_TARGETS.target_reps);
  const [rpe, setRpe] = useState(String(DEFAULT_TARGETS.target_rpe ?? ""));
  const [kg, setKg] = useState("");
  const [rest, setRest] = useState(String(DEFAULT_TARGETS.rest_seconds ?? ""));
  const [circuit, setCircuit] = useState<string>("");
  const field = (text: string, value: string, set: (v: string) => void, mode: "numeric" | "decimal" | "text" = "numeric") => (
    <label className="flex flex-col gap-0.5"><span className={label}>{text}</span>
      <input inputMode={mode === "text" ? undefined : mode} value={value} onChange={(e) => set(e.target.value)} className={cell} /></label>
  );
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-accent bg-bg p-3">
      <p className="text-sm font-bold">{exercise.name_ro ?? exercise.name_en}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {field(m.colSets, sets, setSets)}
        {field(m.colReps, reps, setReps, "text")}
        {field(intensityLabel, rpe, setRpe, "decimal")}
        {field(m.colKg, kg, setKg, "decimal")}
        {field(m.colRest, rest, setRest)}
        <label className="flex flex-col gap-0.5"><span className={label}>{m.circuit}</span>
          <select value={circuit} onChange={(e) => setCircuit(e.target.value)} className={cell}>
            <option value="">{m.noCircuit}</option>
            {circuits.map((c) => <option key={c} value={c}>{circuitLabel(c)}</option>)}
            <option value="new">{m.newCircuit}</option>
          </select></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onAdd(
              {
                target_sets: Number(sets),
                target_reps: reps.trim(),
                target_rpe: parseDecimal(rpe),
                target_weight_kg: parseDecimal(kg),
                rest_seconds: rest.trim() === "" ? null : Number(rest),
              },
              circuit === "" ? null : circuit === "new" ? next : Number(circuit),
            )
          }
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {m.addWithTargets}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink-faint hover:text-ink">
          {t.common.actions.cancel}
        </button>
      </div>
    </div>
  );
}
