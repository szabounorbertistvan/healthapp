"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgram } from "@/app/builder-actions";
import { useI18n } from "@/lib/i18n/client";

export function NewProgramForm({
  roster,
  initialClientId,
}: {
  roster: { id: string; name: string }[];
  /** Preselected when the coach arrived from a specific client's page. */
  initialClientId?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.coachWidgets.newProgramForm;
  const [name, setName] = useState("");
  // A ?client= that is not on the roster (stale link, ended relationship) falls
  // back to the first entry rather than posting an id the policy would reject.
  const [clientId, setClientId] = useState(
    roster.some((c) => c.id === initialClientId) ? initialClientId! : (roster[0]?.id ?? ""),
  );
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

  // An admin, or a coach whose first client has not accepted yet, reaches this
  // page with an empty roster. Rendering the form anyway posted an empty
  // clientId and surfaced a raw Postgres RLS error; say what is missing instead.
  if (roster.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="font-display text-lg font-bold tracking-tight">{t.coachWidgets.noClients.title}</p>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
          {t.coachWidgets.noClients.body}
        </p>
        <Link
          href="/clients"
          className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90"
        >
          {t.coachWidgets.noClients.action}
        </Link>
      </div>
    );
  }

  const field =
    "h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-accent";
  const legend = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint";

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Two columns once there is room; one on a phone. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={legend}>{m.programName}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={m.namePlaceholder}
            className={field}
            autoFocus
          />
        </div>

        <div>
          <label className={legend}>{m.client}</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={field}>
            {roster.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={legend}>{m.weeks}</label>
          <input
            type="number"
            min={1}
            max={52}
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className={`${field} tabular-nums`}
          />
        </div>

        <div>
          <label className={legend}>{m.intensity}</label>
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

      {error ? (
        <p className="rounded-2xl bg-risk-soft px-4 py-3 text-sm font-semibold text-risk">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          disabled={pending}
          className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? m.creating : m.createDraft}
        </button>
        <p className="text-[12.5px] text-ink-faint">{m.draftNote}</p>
      </div>
    </form>
  );
}
