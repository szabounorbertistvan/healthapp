"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCustomFood } from "@/app/nutrition-actions";
import { settle } from "@/lib/settle-action";
import { useI18n } from "@/lib/i18n/client";
import type { MyCustomFood } from "@/lib/client-nutrition";
import { NewFoodForm } from "./new-food-form";
import { Card, EmptyState } from "./ui";

/**
 * "My foods": the foods the person created from a search or a barcode miss,
 * each with Edit (the creation form, filled in) and Delete. New ones can be
 * made here too, without going through the logger.
 */
export function MyFoods({ foods }: { foods: MyCustomFood[] }) {
  const { t } = useI18n();
  const m = t.clientApp.myFoods;
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="mt-5">
        {creating ? (
          <NewFoodForm
            onCreated={() => {
              setCreating(false);
              router.refresh();
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg"
          >
            + {m.newFood}
          </button>
        )}
      </div>

      {foods.length === 0 ? (
        <div className="mt-5"><EmptyState plain title={m.empty} hint={m.emptyHint} /></div>
      ) : (
        <ul className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {foods.map((food) => <MyFoodRow key={food.id} food={food} />)}
        </ul>
      )}
    </>
  );
}

function MyFoodRow({ food }: { food: MyCustomFood }) {
  const { t } = useI18n();
  const m = t.clientApp.myFoods;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const p = food.per_100g;

  function remove() {
    start(async () => {
      setError(null);
      const r = await settle(() => deleteCustomFood(food.id), t.common.actions.unreachable);
      if (r.ok) router.refresh();
      else {
        setConfirming(false);
        setError(r.message ?? m.failed);
      }
    });
  }

  if (editing) {
    return (
      <li className="md:col-span-2 2xl:col-span-3">
        <NewFoodForm
          editing={food}
          onCreated={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li>
      <Card plain className="flex h-full flex-col sm:p-5">
        <h2 className="font-display text-base font-bold leading-tight tracking-tight">{food.name}</h2>
        {food.brand ? <p className="mt-0.5 text-[12px] text-ink-faint">{food.brand}</p> : null}
        <p className="mt-1.5 text-[12.5px] tabular-nums text-ink-soft">
          <b className="font-semibold text-ink">{p.kcal} kcal</b> · P {p.protein} g · C {p.carbs} g · G {p.fat} g {m.per100g}
        </p>
        {food.portions.length > 0 || food.barcode ? (
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            {food.portions.map((x) => `${x.label} = ${x.grams} g`).join(" · ")}
            {food.portions.length > 0 && food.barcode ? " · " : ""}
            {food.barcode ? `${m.barcode} ${food.barcode}` : ""}
          </p>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-[12.5px] text-risk">{error}</p> : null}
        <div className="mt-auto flex flex-wrap justify-end gap-3 pt-3 text-[12px]">
          {confirming ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ink-soft">{m.removeConfirm}</span>
              <button type="button" onClick={remove} disabled={pending} className="font-semibold text-risk">{m.removeYes}</button>
              <button type="button" onClick={() => setConfirming(false)} className="font-semibold text-ink-faint">{t.common.actions.cancel}</button>
            </span>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)} className="font-semibold text-accent-ink hover:underline">{m.edit}</button>
              <button type="button" onClick={() => setConfirming(true)} className="font-semibold text-ink-faint hover:text-risk">{m.remove}</button>
            </>
          )}
        </div>
      </Card>
    </li>
  );
}
