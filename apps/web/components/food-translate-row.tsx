"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFoodRomanianName } from "@/app/food-admin-actions";
import { useI18n } from "@/lib/i18n/client";

/** One row of the admin translation table: English name, editable Romanian name. */
export function FoodTranslateRow({
  id,
  nameEn,
  nameRo,
  kcal,
}: {
  id: string;
  nameEn: string;
  nameRo: string | null;
  kcal: number;
}) {
  const { t } = useI18n();
  const m = t.coachApp.admin.foods;
  const router = useRouter();
  const [value, setValue] = useState(nameRo ?? "");
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== (nameRo ?? "");

  function save() {
    if (!dirty || pending) return;
    startTransition(async () => {
      const result = await setFoodRomanianName(id, value);
      if (!result.ok) {
        setState("error");
        setMessage(result.message ?? null);
        return;
      }
      setState("saved");
      setMessage(null);
      router.refresh();
    });
  }

  return (
    <tr>
      <td className="px-5 py-3.5 align-top">
        <p className="text-sm font-medium">{nameEn}</p>
        <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">{Math.round(kcal)} kcal/100 g</p>
      </td>
      <td className="px-5 py-3.5 align-top">
        <div className="flex items-center gap-2">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setState("idle");
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={m.placeholder}
            lang="ro"
            className="w-full min-w-40 rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={save}
            className="inline-flex h-10 shrink-0 items-center rounded-full bg-accent px-4 font-display text-[12.5px] font-bold text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {m.save}
          </button>
          {state === "saved" && !dirty ? (
            <span className="shrink-0 text-[12px] font-semibold text-accent-ink">{m.saved}</span>
          ) : null}
        </div>
        {state === "error" ? (
          <p className="mt-1.5 text-[12px] font-semibold text-risk">{message ?? t.common.actions.nothingChanged}</p>
        ) : null}
      </td>
    </tr>
  );
}
