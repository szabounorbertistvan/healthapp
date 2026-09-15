"use client";
import { useState } from "react";
import type { Macros } from "@healthapp/shared";
import { useI18n } from "@/lib/i18n/client";
import { Card } from "./ui";
import { NavIcon } from "./client-nav";
import { MacroTargetsForm } from "./macro-targets-form";

/**
 * The day at a glance: goal and consumed as two tiles, what is left (or over)
 * as the big figure with a 0 → goal bar, and the three macros as rings. The
 * goal is whatever `getMyDayNutrition` resolved — the coach's published plan
 * while a coach is active, otherwise the client's own targets — and "Targets"
 * opens the same editor as before, below the card.
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
  const ratio = hasTarget ? Math.min(Math.max(totals.kcal / target.kcal, 0), 1) : 0;
  const source =
    planOwner === "coach" ? f.setByCoach : planOwner === "self" ? f.setByYou : f.noTarget;

  return (
    <div className="space-y-4">
      <Card plain>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {planName ?? t.common.macros.todayTitle}
          </p>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-bg px-3.5 text-[12.5px] font-semibold text-accent-ink"
          >
            <NavIcon d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" className="h-[15px] w-[15px]" />
            {f.editTargets}
          </button>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-bg px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{f.goal}</p>
            <p className="mt-1 font-display text-2xl font-extrabold tabular-nums leading-none">
              {hasTarget ? target.kcal : "—"}
              <span className="ml-1 font-sans text-xs font-semibold text-ink-faint">kcal</span>
            </p>
            <p className="mt-1.5 truncate text-[11px] text-accent-ink">{source}</p>
          </div>
          <div className="rounded-2xl bg-bg px-3.5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{f.consumed}</p>
            <p className="mt-1 font-display text-2xl font-extrabold tabular-nums leading-none">
              {consumed}
              <span className="ml-1 font-sans text-xs font-semibold text-ink-faint">kcal</span>
            </p>
            {hasTarget ? (
              <p className="mt-1.5 text-[11px] tabular-nums text-ink-faint">
                {Math.round((totals.kcal / target.kcal) * 100)}%
              </p>
            ) : null}
          </div>
        </div>

        {/* what is left, then the bar from 0 to the goal */}
        <div className="mt-[18px] flex items-baseline justify-between gap-3">
          <p className={`font-display text-[34px] font-extrabold tabular-nums leading-none ${over ? "text-warn" : ""}`}>
            {hasTarget ? Math.abs(remaining) : consumed}
            <span className="ml-1.5 font-sans text-[13px] font-medium text-ink-faint">
              {hasTarget ? (over ? f.kcalOver : f.kcalLeft) : "kcal"}
            </span>
          </p>
          {hasTarget ? <p className="shrink-0 text-[11px] tabular-nums text-ink-faint">0 – {target.kcal}</p> : null}
        </div>
        <div className="mt-2.5 h-2.5 overflow-hidden rounded-md bg-bg">
          <div
            className={`h-full rounded-md transition-[width] duration-500 ${over ? "bg-warn" : "bg-accent"}`}
            style={{ width: `${over ? 100 : ratio * 100}%` }}
          />
        </div>

        <ul className="mt-4 grid grid-cols-3 gap-2.5">
          <MacroRing label={t.common.macros.protein} value={totals.protein} target={target.protein} />
          <MacroRing label={t.common.macros.carbs} value={totals.carbs} target={target.carbs} />
          <MacroRing label={t.common.macros.fat} value={totals.fat} target={target.fat} />
        </ul>
      </Card>

      {editing ? (
        <MacroTargetsForm target={target} planOwner={planOwner} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

/** One macro as a tile: its label, a ring with the percentage, the grams against the target. Gold to the target, orange past it. */
function MacroRing({ label, value, target }: { label: string; value: number; target: number }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const hasTarget = target > 0;
  const ratio = hasTarget ? value / target : 0;
  const over = ratio > 1.05;
  const dash = c * Math.min(Math.max(ratio, 0), 1);
  return (
    <li className="flex flex-col items-center gap-2 rounded-2xl bg-bg px-2 pb-2.5 pt-3 text-center">
      <p className="w-full truncate text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-line)" strokeWidth="7" />
          {dash > 0 ? (
            <circle
              cx="32" cy="32" r={r} fill="none"
              stroke={over ? "var(--color-warn)" : "var(--color-accent)"}
              strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
            />
          ) : null}
        </svg>
        <span className="absolute inset-0 grid place-items-center font-display text-[13px] font-bold tabular-nums">
          {hasTarget ? `${Math.round(ratio * 100)}%` : `${Math.round(value)} g`}
        </span>
      </div>
      <p className="text-sm font-bold tabular-nums">
        {Math.round(value)}
        <span className="text-[11px] font-medium text-ink-faint">{hasTarget ? ` / ${Math.round(target)} g` : " g"}</span>
      </p>
    </li>
  );
}
