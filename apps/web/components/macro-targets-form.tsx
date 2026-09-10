"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  gramsFromSplit, KCAL_PER_GRAM, MACRO_KEYS, rebalanceSplit, splitFromGrams,
  type Macros, type MacroKey, type MacroSplit,
} from "@healthapp/shared";
import { setMyNutritionTargets } from "@/app/client-actions-app";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";

/**
 * The client's own calorie target and macro split, eat&track style: type the
 * calories, drag one of three percentage sliders and the other two rebalance
 * so the total is always exactly 100%. Grams update live from the same
 * formula the server saves with (@healthapp/shared), so what is previewed is
 * what is stored.
 */
export function MacroTargetsForm({
  target,
  planOwner,
  onClose,
}: {
  /** Today's active target (zeros when there is none). */
  target: Macros;
  planOwner: "coach" | "self" | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const m = t.clientApp.nutritionTargets;
  const labels = t.clientWidgets.macroTargets;
  const [kcal, setKcal] = useState(String(target.kcal > 0 ? target.kcal : 2000));
  const [split, setSplit] = useState<MacroSplit>(() => splitFromGrams(target));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const kcalNum = parseInt(kcal, 10);
  const kcalValid = Number.isFinite(kcalNum) && kcalNum >= 500 && kcalNum <= 10000;
  const grams = gramsFromSplit(kcalValid ? kcalNum : 0, split);
  const total = split.protein + split.carbs + split.fat;

  function change(key: MacroKey, value: number) {
    setSaved(false);
    setSplit((prev) => rebalanceSplit(prev, key, value));
  }

  function save() {
    if (!kcalValid) return;
    startTransition(async () => {
      setError(null);
      const result = await setMyNutritionTargets({ kcal: kcalNum, split });
      if (!result.ok) {
        setError(result.message ?? m.couldNotSave);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.title}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-ink-faint hover:text-ink"
        >
          {t.common.actions.close}
        </button>
      </div>
      {planOwner === "coach" ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">{m.coachNote}</p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.kcal}</span>
        <div className="flex items-baseline gap-2">
          <input
            inputMode="numeric"
            value={kcal}
            onChange={(e) => {
              setSaved(false);
              setKcal(e.target.value.replace(/[^\d]/g, ""));
            }}
            className={`w-28 rounded-lg border bg-surface px-3 py-2 text-lg font-bold tabular-nums outline-none focus:border-accent ${
              kcalValid ? "border-line" : "border-risk"
            }`}
          />
          <span className="text-sm text-ink-faint">kcal {m.perDay}</span>
        </div>
        <span className="text-[10px] text-ink-faint">{m.kcalHint}</span>
      </label>

      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.split}</p>
          <p className="text-xs tabular-nums">
            {m.total}{" "}
            <b className={total === 100 ? "text-accent-ink" : "text-risk"}>{total}%</b>
          </p>
        </div>
        <p className="mt-0.5 text-[10px] text-ink-faint">{m.splitHint}</p>
        <div className="mt-3 space-y-3">
          {MACRO_KEYS.map((key) => (
            <div key={key}>
              <div className="flex items-baseline justify-between text-sm">
                <label htmlFor={`split-${key}`} className="font-semibold text-ink-soft">
                  {labels[key]}
                  <span className="ml-1 text-[10px] font-normal text-ink-faint">
                    {fill(labels.kcalPerGram, { n: KCAL_PER_GRAM[key] })}
                  </span>
                </label>
                <span className="tabular-nums">
                  <b className="text-ink">{split[key]}%</b>
                  <span className="ml-2 text-ink-faint">
                    {grams[key]} {labels.grams}
                  </span>
                </span>
              </div>
              <input
                id={`split-${key}`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={split[key]}
                onChange={(e) => change(key, parseInt(e.target.value, 10))}
                className="mt-1 w-full"
              />
            </div>
          ))}
        </div>
        {/* one bar, three colours: the split at a glance */}
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-bg" aria-hidden>
          <div className="bg-accent" style={{ width: `${split.protein}%` }} />
          <div className="bg-accent-ink/60" style={{ width: `${split.carbs}%` }} />
          <div className="bg-warn" style={{ width: `${split.fat}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !kcalValid || total !== 100}
          onClick={save}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40"
        >
          {pending ? t.common.actions.saving : t.common.actions.save}
        </button>
        {saved ? <span className="text-xs font-semibold text-accent-ink">{m.saved}</span> : null}
        {error ? <span className="text-xs font-semibold text-risk">{error}</span> : null}
      </div>
    </Card>
  );
}
