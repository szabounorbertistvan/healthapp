"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgram } from "@/app/builder-actions";
import { useI18n } from "@/lib/i18n/client";

export function NewProgramForm({ roster }: { roster: { id: string; name: string }[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.coachWidgets.newProgramForm;
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState(roster[0]?.id ?? "");
  const [weeks, setWeeks] = useState(6);
  // RIR is the default per the plan's open decision: "both — coach chooses per client".
  const [intensityMode, setIntensityMode] = useState<"rir" | "rpe" | "simple">("rir");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const client = roster.find((c) => c.id === clientId);
      const result = await createProgram({
        name,
        clientId,
        clientName: client?.name ?? "—",
        weeks,
        intensityMode,
      });
      if (result.ok && result.id) router.push(`/programs/${result.id}`);
      else setError(result.message ?? m.createError);
    });
  }

  const field =
    "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {m.programName}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={m.namePlaceholder}
          className={field}
          autoFocus
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {m.client}
        </label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={field}>
          {roster.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {m.weeks}
          </label>
          <input
            type="number"
            min={1}
            max={52}
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className={field}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {m.intensity}
          </label>
          <select
            value={intensityMode}
            onChange={(e) => setIntensityMode(e.target.value as "rir" | "rpe" | "simple")}
            className={field}
          >
            <option value="rir">{m.intensityRir}</option>
            <option value="rpe">{m.intensityRpe}</option>
            <option value="simple">{m.intensitySimple}</option>
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-risk">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? m.creating : m.createDraft}
      </button>
      <p className="text-xs text-ink-faint">{m.draftNote}</p>
    </form>
  );
}
