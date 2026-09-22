"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createNutritionPlan } from "@/app/nutrition-actions";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";

export function NewPlanForm({
  roster,
  initialClientId,
}: {
  roster: { id: string; name: string }[];
  /** Preselected when the coach arrived from a specific client's page. */
  initialClientId?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const m = t.coachWidgets.newPlanForm;
  const [name, setName] = useState("");
  // An off-roster ?client= (stale link, ended relationship) falls back to the
  // first entry rather than posting an id the policy would reject.
  const [clientId, setClientId] = useState(
    roster.some((c) => c.id === initialClientId) ? initialClientId! : (roster[0]?.id ?? ""),
  );
  const [kcal, setKcal] = useState(1800);
  const [protein, setProtein] = useState(150);
  const [carbs, setCarbs] = useState(160);
  const [fat, setFat] = useState(55);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Macros carry 4/4/9 kcal per gram; showing the implied total lets the coach
  // notice a target that does not add up before any food is chosen.
  const impliedKcal = protein * 4 + carbs * 4 + fat * 9;
  const mismatch = Math.abs(impliedKcal - kcal) > kcal * 0.05;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const client = roster.find((c) => c.id === clientId);
      const result = await createNutritionPlan({
        name,
        clientId,
        clientName: client?.name ?? "—",
        kcal,
        protein,
        carbs,
        fat,
      });
      if (result.ok && result.id) router.push(`/nutrition/${result.id}`);
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
    "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent";
  const label = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint";

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <div>
        <label className={label}>{m.planName}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={m.namePlaceholder}
          className={field}
          autoFocus
        />
      </div>

      <div>
        <label className={label}>{m.client}</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={field}>
          {roster.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>{m.dailyCalories}</label>
        <input
          type="number"
          min={500}
          max={10000}
          value={kcal}
          onChange={(e) => setKcal(Number(e.target.value))}
          className={`${field} tabular-nums`}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label}>{m.proteinG}</label>
          <input type="number" min={0} value={protein} onChange={(e) => setProtein(Number(e.target.value))} className={`${field} tabular-nums`} />
        </div>
        <div>
          <label className={label}>{m.carbsG}</label>
          <input type="number" min={0} value={carbs} onChange={(e) => setCarbs(Number(e.target.value))} className={`${field} tabular-nums`} />
        </div>
        <div>
          <label className={label}>{m.fatG}</label>
          <input type="number" min={0} value={fat} onChange={(e) => setFat(Number(e.target.value))} className={`${field} tabular-nums`} />
        </div>
      </div>

      <p className={`text-[12.5px] tabular-nums ${mismatch ? "text-warn" : "text-ink-faint"}`}>
        {fill(m.macrosAddUp, { kcal: impliedKcal })}
        {mismatch ? m.macrosMismatch : ""}
      </p>

      {error ? <p className="text-[13px] font-semibold text-risk">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="flex h-11 items-center justify-center rounded-2xl bg-accent px-5 font-display text-sm font-bold text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {pending ? m.creating : m.createDraft}
      </button>
    </form>
  );
}
