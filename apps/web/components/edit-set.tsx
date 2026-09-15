"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseDecimal } from "@healthapp/shared";
import { updateLoggedSet } from "@/app/client-actions-app";
import { useI18n } from "@/lib/i18n/client";
import type { LoggedSetRow } from "@/lib/types";

type Editable = Pick<LoggedSetRow, "id" | "weight_kg" | "reps" | "rpe" | "rir" | "notes" | "is_pr">;

const field = "w-full min-w-0 rounded-lg border border-line bg-bg px-2 py-2 text-sm tabular-nums outline-none focus:border-accent";
const label = "text-[10px] font-semibold uppercase tracking-wider text-ink-faint";

/**
 * Correct a logged set in place: weight, reps, RIR (in an RIR program),
 * felt intensity and the note. Saves through updateLoggedSet(), which
 * re-derives the PR flags; everything else that reads the set (volume, load,
 * summaries) is computed from the row and follows. Values are kept exactly
 * as typed — 82.5 is 82.5.
 */
export function EditSet({
  set,
  asRir,
  dayId,
  onDone,
}: {
  set: Editable;
  asRir: boolean;
  dayId?: string | null;
  /** Called with the saved values, or null when cancelled. */
  onDone: (updated: Editable | null) => void;
}) {
  const { t } = useI18n();
  const m = t.clientWidgets.setLogger;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weight, setWeight] = useState(String(set.weight_kg));
  const [reps, setReps] = useState(String(set.reps));
  const [rir, setRir] = useState(set.rir === null ? "" : String(set.rir));
  const [rpe, setRpe] = useState(set.rpe === null ? "" : String(set.rpe));
  const [notes, setNotes] = useState(set.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    const edit = {
      weight_kg: parseDecimal(weight) ?? NaN,
      reps: Number(reps),
      rpe: rpe.trim() === "" ? null : parseDecimal(rpe),
      rir: asRir && rir.trim() !== "" ? parseDecimal(rir) : null,
      notes: notes.trim() || null,
    };
    startTransition(async () => {
      setError(null);
      const r = await updateLoggedSet(set.id, edit, dayId ?? null);
      if (!r.ok) {
        setError(r.message ?? m.couldNotEdit);
        return;
      }
      onDone({ id: set.id, ...edit, is_pr: r.is_pr ?? set.is_pr });
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-accent bg-surface p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{m.editSet}</p>
      <div className={`grid gap-2 ${asRir ? "grid-cols-4" : "grid-cols-3"}`}>
        <label className="flex flex-col gap-0.5"><span className={label}>{m.kg}</span>
          <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} className={field} /></label>
        <label className="flex flex-col gap-0.5"><span className={label}>{m.reps}</span>
          <input inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} className={field} /></label>
        {asRir ? (
          <label className="flex flex-col gap-0.5"><span className={label}>{m.rir}</span>
            <input inputMode="decimal" value={rir} onChange={(e) => setRir(e.target.value)} className={field} /></label>
        ) : null}
        <label className="flex flex-col gap-0.5"><span className={label}>{m.intensity}</span>
          <input inputMode="numeric" value={rpe} placeholder="1-10" onChange={(e) => setRpe(e.target.value)} className={field} /></label>
      </div>
      <input
        value={notes}
        maxLength={500}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={m.notePlaceholder}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {error ? <p className="text-xs text-risk">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={save} className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40">
          {t.common.actions.save}
        </button>
        <button type="button" disabled={pending} onClick={() => onDone(null)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-ink-faint hover:text-ink">
          {t.common.actions.cancel}
        </button>
      </div>
    </div>
  );
}
