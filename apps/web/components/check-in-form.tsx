"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitCheckIn } from "@/app/client-actions-app";
import { Card } from "./ui";

const SCALES = [
  { key: "sleep", label: "Sleep quality" },
  { key: "energy", label: "Energy" },
  { key: "stress", label: "Stress" },
  { key: "hunger", label: "Hunger" },
  { key: "recovery", label: "Recovery" },
] as const;

type ScaleKey = (typeof SCALES)[number]["key"];

export function CheckInForm() {
  const router = useRouter();
  const [weight, setWeight] = useState("");
  const [scores, setScores] = useState<Record<ScaleKey, number>>({
    sleep: 5,
    energy: 5,
    stress: 5,
    hunger: 5,
    recovery: 5,
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <div className="space-y-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            weight kg
          </span>
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="optional"
            className="w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm tabular-nums outline-none focus:border-accent"
          />
        </label>

        {SCALES.map((scale) => (
          <div key={scale.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">{scale.label}</span>
              <span className="text-sm font-bold tabular-nums text-accent-ink">
                {scores[scale.key]}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={scores[scale.key]}
              onChange={(e) =>
                setScores((prev) => ({ ...prev, [scale.key]: Number(e.target.value) }))
              }
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </div>
        ))}

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            anything your coach should know
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>

        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const parsed = parseFloat(weight);
              const result = await submitCheckIn({
                weightKg: weight.trim() === "" || !Number.isFinite(parsed) ? null : parsed,
                ...scores,
                note,
              });
              if (!result.ok) {
                setError(result.message ?? "Could not submit");
                return;
              }
              router.refresh();
            })
          }
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Submit check-in
        </button>

        {error ? <p className="text-sm font-semibold text-risk">{error}</p> : null}
      </div>
    </Card>
  );
}
