"use client";
import { useState } from "react";
import type { Macros } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { MacroTargetsForm } from "./macro-targets-form";

/**
 * The day at a glance. A half-circle gauge carries what is left (or what is
 * over), with goal and consumed as two tiles under it and the three macros as
 * small rings. The goal is whatever `getMyDayNutrition` resolved — the coach's
 * published plan while a coach is active, otherwise the client's own targets —
 * and "Targets" opens the same editor as before, below the card.
 */
export function NutritionSummary({
  totals,
  target,
  planOwner,
  planName,
}: {
  totals: Macros;
  target: Macros;
  planOwner: "coach" | "self" | null;
  planName: string | null;
}) {
  const { t } = useI18n();
  const f = t.clientApp.food;
  const [editing, setEditing] = useState(false);

  const hasTarget = target.kcal > 0;
  const consumed = Math.round(totals.kcal);
  const remaining = Math.round(target.kcal - totals.kcal);
  const over = hasTarget && remaining < 0;
  const source =
    planOwner === "coach" ? f.setByCoach : planOwner === "self" ? f.setByYou : f.noTarget;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {planName ?? t.common.macros.todayTitle}
          </p>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-accent-ink hover:border-accent"
          >
            <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden>
              <path d="M13.6 2.6a2 2 0 0 1 2.8 2.8l-8.9 8.9-3.6.8.8-3.6 8.9-8.9zM12.2 5.4l2.4 2.4 1.4-1.4-2.4-2.4-1.4 1.4z" />
            </svg>
            {f.editTargets}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-bg px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{f.goal}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums leading-none">
              {hasTarget ? target.kcal : "—"}
              <span className="ml-1 text-xs font-semibold text-ink-faint">kcal</span>
            </p>
            <p className="mt-1 truncate text-[11px] text-accent-ink">{source}</p>
          </div>
          <div className="rounded-xl bg-bg px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{f.consumed}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums leading-none">
              {consumed}
              <span className="ml-1 text-xs font-semibold text-ink-faint">kcal</span>
            </p>
            {hasTarget ? (
              <p className="mt-1 text-[11px] tabular-nums text-ink-faint">
                {Math.round((totals.kcal / target.kcal) * 100)}%
              </p>
            ) : null}
          </div>
        </div>

        {/* gauge on the left, the three macros as a column on the right */}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <KcalGauge
            consumed={totals.kcal}
            target={target.kcal}
            value={hasTarget ? Math.abs(remaining) : consumed}
            label={hasTarget ? (over ? f.kcalOver : f.kcalLeft) : "kcal"}
            over={over}
          />
          <ul className="space-y-2.5 border-l border-line pl-4">
            <MacroRing label={t.common.macros.protein} value={totals.protein} target={target.protein} />
            <MacroRing label={t.common.macros.carbs} value={totals.carbs} target={target.carbs} />
            <MacroRing label={t.common.macros.fat} value={totals.fat} target={target.fat} />
          </ul>
        </div>
      </Card>

      {editing ? (
        <MacroTargetsForm target={target} planOwner={planOwner} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

/** Half-circle gauge: consumed over target, 0 on the left, the goal on the right. */
function KcalGauge({
  consumed,
  target,
  value,
  label,
  over,
}: {
  consumed: number;
  target: number;
  value: number;
  label: string;
  over: boolean;
}) {
  const width = 260;
  const stroke = 14;
  const r = (width - stroke) / 2;
  const cx = width / 2;
  const cy = r + stroke / 2;
  const half = Math.PI * r;
  const ratio = target > 0 ? Math.min(Math.max(consumed / target, 0), 1) : 0;
  const arc = `M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${width - stroke / 2} ${cy}`;

  return (
    <div className="w-full max-w-[240px]">
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${cy + stroke / 2}`} className="w-full" aria-hidden>
          <path d={arc} fill="none" stroke="var(--color-line)" strokeWidth={stroke} strokeLinecap="round" />
          {ratio > 0 ? (
            <path
              d={arc}
              fill="none"
              stroke={over ? "var(--color-warn)" : "var(--color-accent)"}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${half * ratio} ${half}`}
              className="transition-[stroke-dasharray] duration-500"
            />
          ) : null}
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center">
          <span className={`text-3xl font-bold tabular-nums leading-none ${over ? "text-warn" : "text-ink"}`}>
            {value}
          </span>
          <span className="mt-1 text-xs text-ink-faint">{label}</span>
        </div>
      </div>
      <div className="mt-1 flex justify-between px-1 text-[10px] tabular-nums text-ink-faint">
        <span>0</span>
        <span>{target > 0 ? target : ""}</span>
      </div>
    </div>
  );
}

/** One macro as a small ring with its figures beside it; gold to the target, orange past it. */
function MacroRing({ label, value, target }: { label: string; value: number; target: number }) {
  const size = 36;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = target > 0 ? value / target : 0;
  const over = ratio > 1.05;
  const dash = c * Math.min(Math.max(ratio, 0), 1);
  return (
    <li className="flex items-center gap-2.5">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-9 w-9 shrink-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        {dash > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={over ? "var(--color-warn)" : "var(--color-accent)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
          />
        ) : null}
      </svg>
      <div className="min-w-0 leading-tight">
        <p className="text-[11px] font-semibold text-ink-soft">{label}</p>
        <p className="text-sm tabular-nums">
          <b>{Math.round(value)}</b>
          <span className="text-xs text-ink-faint">{target > 0 ? ` / ${Math.round(target)} g` : " g"}</span>
        </p>
      </div>
    </li>
  );
}
