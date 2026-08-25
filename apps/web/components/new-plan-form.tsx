"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createNutritionPlan } from "@/app/nutrition-actions";

export function NewPlanForm({ roster }: { roster: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState(roster[0]?.id ?? "");
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
      else setError(result.message ?? "Could not create the plan");
    });
  }

  const field =
    "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint";

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <div>
        <label className={label}>Plan name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Andrei · Cut phase"
          className={field}
          autoFocus
        />
      </div>

      <div>
        <label className={label}>Client</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={field}>
          {roster.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Daily calories</label>
        <input
          type="number"
          min={500}
          max={10000}
          value={kcal}
          onChange={(e) => setKcal(Number(e.target.value))}
          className={field}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label}>Protein g</label>
          <input type="number" min={0} value={protein} onChange={(e) => setProtein(Number(e.target.value))} className={field} />
        </div>
        <div>
          <label className={label}>Carbs g</label>
          <input type="number" min={0} value={carbs} onChange={(e) => setCarbs(Number(e.target.value))} className={field} />
        </div>
        <div>
          <label className={label}>Fat g</label>
          <input type="number" min={0} value={fat} onChange={(e) => setFat(Number(e.target.value))} className={field} />
        </div>
      </div>

      <p className={`text-xs tabular-nums ${mismatch ? "text-warn" : "text-ink-faint"}`}>
        Macros add up to {impliedKcal} kcal
        {mismatch ? " — that is more than 5% away from the calorie target" : ""}
      </p>

      {error ? <p className="text-sm text-risk">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create draft"}
      </button>
    </form>
  );
}
