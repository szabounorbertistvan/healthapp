"use client";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  DEFAULT_TARGETS, circuitLabel, circuitSegments, displayToKg, exerciseRef, kgToDisplay,
  nextCircuit, parseDecimal, type ExerciseSummary, type ExerciseTargets,
} from "@healthapp/shared";
import {
  addProgramExercise, moveProgramDay, moveProgramExercise, removeProgramExercise, renameProgramDay,
  replaceProgramExercise, setExerciseCircuit, updateProgramExercise,
} from "@/app/builder-actions";
import { ExercisePicker } from "@/components/exercise-picker";
import { NavIcon } from "@/components/client-nav";
import { Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { useUnits } from "@/lib/units/client";
import { fill } from "@/lib/i18n";
import type { ProgramDetail, ProgramExerciseRow } from "@/lib/types";

type Run = (action: () => Promise<{ ok: boolean; message?: string }>) => void;

// Dense but never cramped: a 40px field is still thumb-sized on a phone.
const cell = "h-10 w-full min-w-0 rounded-xl border border-line bg-bg px-2.5 text-sm tabular-nums outline-none focus:border-accent";
const label = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";
/** Round icon button for the chrome around a day and its rows. */
const iconButton = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-soft hover:text-accent-ink disabled:opacity-30";
const PENCIL = "M4 20h4l10-10-4-4L4 16zM13 7l4 4";
const CHEVRON_UP = "m6 15 6-6 6 6";
const CHEVRON_DOWN = "m6 9 6 6 6-6";

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
    <Card plain className="sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <DayName name={day.name} disabled={pending} onSave={(name) => run(() => renameProgramDay(program.id, day.id, name))} />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={pending || index === 0}
            onClick={() => run(() => moveProgramDay(program.id, day.id, -1))}
            aria-label={m.moveUp}
            title={m.moveUp}
            className={`${iconButton} bg-bg`}
          >
            <NavIcon d={CHEVRON_UP} className="h-[17px] w-[17px]" />
          </button>
          <button
            type="button"
            disabled={pending || index >= total - 1}
            onClick={() => run(() => moveProgramDay(program.id, day.id, 1))}
            aria-label={m.moveDown}
            title={m.moveDown}
            className={`${iconButton} bg-bg`}
          >
            <NavIcon d={CHEVRON_DOWN} className="h-[17px] w-[17px]" />
          </button>
          {/* Both labels carry their own glyph in the string, so no icon here. */}
          <button
            type="button"
            onClick={() => { setPicking((v) => !v); setReplacing(null); setCandidate(null); }}
            aria-expanded={picking}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-semibold ${
              picking ? "bg-accent-soft text-accent-ink" : "bg-bg text-ink-soft hover:text-ink"
            }`}
          >
            {picking ? m.closeLibrary : m.addExercise}
          </button>
          {actions}
        </div>
      </div>

      {day.exercises.length === 0 && !picking ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-faint">{m.noExercises}</p>
      ) : null}

      <div className="space-y-2.5">
        {segments.map((seg, si) => (
          <div
            key={seg.circuit ?? `solo-${si}`}
            className={seg.circuit !== null ? "rounded-2xl border-l-[3px] border-accent bg-accent-soft/30 p-2.5 pl-3" : ""}
          >
            {seg.label ? (
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">
                <NavIcon d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" className="h-[15px] w-[15px]" />
                {fill(m.circuitName, { label: seg.label })} · {fill(m.circuitRounds, { n: seg.exercises.length })}
              </p>
            ) : null}
            <div className="space-y-2.5">
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

      {/* The picker brings its own surface language (bg-bg pills and cards), so
          its panel stays on the card and is delimited by a border only. */}
      {replacing ? (
        <div className="mt-4 flex h-[clamp(32rem,82vh,64rem)] flex-col rounded-2xl border border-accent p-3.5">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{m.changeExercise}</p>
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
          <div className="mt-4 flex h-[clamp(32rem,82vh,64rem)] flex-col rounded-2xl border border-line/60 p-3.5">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{fill(m.addTo, { name: day.name })}</p>
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
        className="flex min-h-9 min-w-0 items-center gap-1.5 rounded-xl text-left font-display text-lg font-bold tracking-tight hover:text-accent-ink"
      >
        <span className="min-w-0 truncate">{name}</span>
        <NavIcon d={PENCIL} className="h-[15px] w-[15px] text-ink-faint" />
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
      className="h-10 min-w-0 flex-1 rounded-xl border border-accent bg-bg px-3 font-display text-lg font-bold outline-none"
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
  const u = useUnits();
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
    <div className={`rounded-2xl p-3 ${replacing ? "bg-accent-soft/60" : "bg-bg"}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onReplace} disabled={disabled} title={m.changeExercise} className="flex min-w-0 flex-1 items-center gap-2 pr-1 text-left text-[15px] font-semibold hover:text-accent-ink">
          <span className="min-w-0 truncate">{row.exercise}</span>
          <NavIcon d={PENCIL} className="h-[14px] w-[14px] text-ink-faint" />
        </button>
        <button type="button" disabled={disabled || first} onClick={() => onMove(-1)} aria-label={m.moveUp} title={m.moveUp} className={`${iconButton} hover:bg-surface`}>
          <NavIcon d={CHEVRON_UP} className="h-4 w-4" />
        </button>
        <button type="button" disabled={disabled || last} onClick={() => onMove(1)} aria-label={m.moveDown} title={m.moveDown} className={`${iconButton} hover:bg-surface`}>
          <NavIcon d={CHEVRON_DOWN} className="h-4 w-4" />
        </button>
        <button type="button" onClick={onRemove} disabled={disabled} title={m.removeExercise} aria-label={m.removeExercise} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-risk-soft hover:text-risk disabled:opacity-50">
          <NavIcon d="M6 6 18 18M18 6 6 18" className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <label className="flex flex-col gap-1"><span className={label}>{m.colSets}</span>
          <input type="number" min={1} max={20} inputMode="numeric" value={values.target_sets} disabled={disabled} onChange={(e) => change({ ...latest.current, target_sets: Number(e.target.value) })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-1"><span className={label}>{m.colReps}</span>
          <input value={values.target_reps} disabled={disabled} placeholder="8-10" onChange={(e) => change({ ...latest.current, target_reps: e.target.value })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-1"><span className={label}>{intensityLabel}</span>
          <input inputMode="decimal" value={values.target_rpe ?? ""} disabled={disabled} onChange={(e) => change({ ...latest.current, target_rpe: num(e.target.value) })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-1"><span className={label}>{m.colKg}</span>
          <input
            inputMode="decimal"
            value={values.target_weight_kg === null || values.target_weight_kg === undefined ? "" : kgToDisplay(values.target_weight_kg, u.weightUnit)}
            disabled={disabled}
            onChange={(e) => {
              const typed = num(e.target.value);
              change({ ...latest.current, target_weight_kg: typed === null ? null : displayToKg(typed, u.weightUnit) });
            }}
            onBlur={commit}
            onKeyDown={enter}
            className={cell}
          /></label>
        <label className="flex flex-col gap-1"><span className={label}>{m.colRest}</span>
          <input type="number" step={15} min={0} max={600} inputMode="numeric" value={values.rest_seconds ?? ""} disabled={disabled} onChange={(e) => change({ ...latest.current, rest_seconds: e.target.value === "" ? null : Number(e.target.value) })} onBlur={commit} onKeyDown={enter} className={cell} /></label>
        <label className="flex flex-col gap-1"><span className={label}>{m.circuit}</span>
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
  // A coach renders this outside the client shell, where the provider's default
  // (metric) applies; a solo client sees their own unit. Either way the
  // prescription is stored in kilograms.
  const u = useUnits();
  const m = t.coachWidgets.programBuilder;
  const [sets, setSets] = useState(String(DEFAULT_TARGETS.target_sets));
  const [reps, setReps] = useState(DEFAULT_TARGETS.target_reps);
  const [rpe, setRpe] = useState(String(DEFAULT_TARGETS.target_rpe ?? ""));
  const [kg, setKg] = useState("");
  const [rest, setRest] = useState(String(DEFAULT_TARGETS.rest_seconds ?? ""));
  const [circuit, setCircuit] = useState<string>("");
  const field = (text: string, value: string, set: (v: string) => void, mode: "numeric" | "decimal" | "text" = "numeric") => (
    <label className="flex flex-col gap-1"><span className={label}>{text}</span>
      <input inputMode={mode === "text" ? undefined : mode} value={value} onChange={(e) => set(e.target.value)} className={cell} /></label>
  );
  return (
    <div className="mt-4 space-y-3.5 rounded-2xl border border-accent p-3.5">
      <p className="font-display text-base font-bold tracking-tight">{exercise.name_ro ?? exercise.name_en}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {field(m.colSets, sets, setSets)}
        {field(m.colReps, reps, setReps, "text")}
        {field(intensityLabel, rpe, setRpe, "decimal")}
        {field(u.weightUnit, kg, setKg, "decimal")}
        {field(m.colRest, rest, setRest)}
        <label className="flex flex-col gap-1"><span className={label}>{m.circuit}</span>
          <select value={circuit} onChange={(e) => setCircuit(e.target.value)} className={cell}>
            <option value="">{m.noCircuit}</option>
            {circuits.map((c) => <option key={c} value={c}>{circuitLabel(c)}</option>)}
            <option value="new">{m.newCircuit}</option>
          </select></label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onAdd(
              {
                target_sets: Number(sets),
                target_reps: reps.trim(),
                target_rpe: parseDecimal(rpe),
                target_weight_kg: (() => {
                  const typed = parseDecimal(kg);
                  return typed === null ? null : displayToKg(typed, u.weightUnit);
                })(),
                rest_seconds: rest.trim() === "" ? null : Number(rest),
              },
              circuit === "" ? null : circuit === "new" ? next : Number(circuit),
            )
          }
          className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {m.addWithTargets}
        </button>
        <button type="button" onClick={onCancel} className="inline-flex h-11 items-center rounded-full px-4 text-[12.5px] font-semibold text-ink-faint hover:text-ink">
          {t.common.actions.cancel}
        </button>
      </div>
    </div>
  );
}
