"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { recipeStepsFromText, recomputedServing, type DialogLine, type Macros } from "@healthapp/shared";
import { createRecipe } from "@/app/recipe-actions";
import { settle } from "@/lib/settle-action";
import { useI18n } from "@/lib/i18n/client";
import { FIELD } from "@/lib/form-classes";
import { FoodSearch } from "./recipe-import-dialog";

type Line = { food: { id: string; name: string; per100: Macros }; grams: number | null };

/**
 * A recipe written in Voinic, from scratch: a title, the foods and their
 * grams, how many servings the pot makes, and optionally the steps. The
 * nutrition shown here is a preview; the server works it out again from the
 * foods (createRecipe), so nothing the browser computes is stored.
 */
export function NewRecipeButton() {
  const { t } = useI18n();
  const m = t.clientApp.recipes.create;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg">
        {m.button}
      </button>
      {open ? <RecipeEditorDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RecipeEditorDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const m = t.clientApp.recipes.create;
  const im = t.clientApp.recipes.import;
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [servings, setServings] = useState("4");
  const [servingGrams, setServingGrams] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [adding, setAdding] = useState(true);
  const [steps, setSteps] = useState("");
  const [prep, setPrep] = useState("");
  const [cook, setCook] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);

  const n = Number(servings.replace(",", "."));
  const servingsOk = n > 0 && n <= 500;
  const dialogLines: DialogLine[] = lines.map((l) => ({ food: { id: l.food.id, per100: l.food.per100 }, grams: l.grams, include: true }));
  const preview = recomputedServing(dialogLines, servingsOk ? n : 1);
  const totalGrams = lines.reduce((s, l) => s + (l.grams ?? 0), 0);
  const proposed = servingsOk && totalGrams > 0 ? Math.round((totalGrams / n) * 10) / 10 : null;

  function edit(i: number, grams: number | null) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, grams } : l)));
  }

  function save() {
    if (!title.trim()) { setError(m.titleRequired); return; }
    if (!servingsOk) { setError(m.servingsRequired); return; }
    if (lines.length === 0) { setError(m.linesRequired); return; }
    if (lines.some((l) => !(l.grams && l.grams > 0))) { setError(m.gramsRequired); return; }
    const g = servingGrams.trim() ? Number(servingGrams.replace(",", ".")) : null;
    if (g !== null && !(g > 0)) { setError(im.servingGramsRequired); return; }
    const toInt = (x: string) => (x.trim() ? Math.max(0, Math.min(1440, Math.round(Number(x)))) : null);
    setError(null);
    start(async () => {
      const result = await settle(() => createRecipe({
        title: title.trim(),
        servings: n,
        servingGrams: g,
        lines: lines.map((l) => ({ foodId: l.food.id, grams: l.grams! })),
        steps: recipeStepsFromText(steps),
        prepMinutes: toInt(prep),
        cookMinutes: toInt(cook),
      }), t.common.actions.unreachable);
      if (!result.ok) { setError(result.message === "RECIPE_LIMIT" ? m.limit : result.message ?? t.clientApp.recipes.failed); return; }
      onClose();
      router.refresh();
    });
  }

  const macroText = (x: Macros) => `${x.kcal} kcal · P ${x.protein} g · C ${x.carbs} g · G ${x.fat} g`;

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <Dialog.Popup
            initialFocus={closeRef}
            className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 outline-none sm:max-h-[92vh] sm:rounded-2xl sm:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="font-display text-lg font-bold tracking-tight">{m.title}</Dialog.Title>
                <p className="mt-1 text-[12.5px] text-ink-soft">{m.lead}</p>
              </div>
              <Dialog.Close ref={closeRef} aria-label={t.clientApp.recipes.cancel}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:border-accent hover:text-ink">
                ✕
              </Dialog.Close>
            </div>

            <label className="mt-4 block text-[12.5px] font-semibold text-ink-soft">
              {m.name}
              <input id="recipe-new-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160}
                placeholder={m.namePlaceholder} className={`${FIELD} font-semibold`} />
            </label>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[12.5px] font-semibold text-ink-soft">
                {im.servings}
                <span className="mt-1 flex items-center gap-2">
                  <input id="recipe-new-servings" inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)}
                    className={`${FIELD} mt-0 w-24 tabular-nums`} />
                  <span className="font-normal text-ink-faint">{im.servingsUnit}</span>
                </span>
              </label>
              <label className="text-[12.5px] font-semibold text-ink-soft">
                {im.servingGrams}
                <span className="mt-1 flex items-center gap-2">
                  <input id="recipe-new-serving-grams" inputMode="decimal" value={servingGrams} onChange={(e) => setServingGrams(e.target.value)}
                    placeholder={proposed ? String(proposed) : ""} className={`${FIELD} mt-0 w-24 tabular-nums`} />
                  <span className="font-normal text-ink-faint">{im.grams}</span>
                </span>
                <span className="mt-1 block text-[11.5px] font-normal text-ink-faint">{m.servingGramsHint}</span>
              </label>
            </div>

            <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{im.ingredients}</p>
            {lines.length === 0 ? <p className="mt-2 text-[12.5px] text-ink-faint">{m.noLines}</p> : (
              <ul className="mt-2 divide-y divide-line/60">
                {lines.map((l, i) => (
                  <li key={`${l.food.id}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{l.food.name}</span>
                    <input inputMode="decimal" aria-label={`${l.food.name} — ${im.grams}`} value={l.grams ?? ""}
                      onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); edit(i, e.target.value.trim() === "" ? null : v > 0 ? v : l.grams); }}
                      className={`${FIELD} mt-0 h-9 w-20 tabular-nums`} placeholder={im.grams} />
                    <span className="text-[12px] text-ink-faint">{im.grams}</span>
                    <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded-lg px-2 py-1 text-[12px] font-semibold text-ink-faint hover:text-ink">
                      {im.remove}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {adding && lines.length < 60 ? (
              <FoodSearch
                placeholder={im.searchPlaceholder}
                empty={im.noResults}
                onPick={(f) => { setLines((prev) => [...prev, { food: { id: f.id, name: f.name_ro || f.name_en, per100: f.per_100g }, grams: 100 }]); setAdding(false); }}
              />
            ) : lines.length < 60 ? (
              <button type="button" onClick={() => setAdding(true)} className="mt-2 self-start text-[12.5px] font-semibold text-accent-ink hover:underline">
                + {m.addLine}
              </button>
            ) : null}

            <label className="mt-5 block text-[12.5px] font-semibold text-ink-soft">
              {t.clientApp.recipes.stepsLabel} <span className="font-normal text-ink-faint">({m.optional})</span>
              <textarea id="recipe-new-steps" value={steps} onChange={(e) => setSteps(e.target.value)} rows={4}
                placeholder={t.clientApp.recipes.stepsPlaceholder} className={`${FIELD} py-2`} />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-[12.5px] font-semibold text-ink-soft">
                {t.clientApp.recipes.prepMinutes}
                <input id="recipe-new-prep" inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} className={`${FIELD} tabular-nums`} />
              </label>
              <label className="text-[12.5px] font-semibold text-ink-soft">
                {t.clientApp.recipes.cookMinutes}
                <input id="recipe-new-cook" inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value)} className={`${FIELD} tabular-nums`} />
              </label>
            </div>

            <div className="mt-4 rounded-2xl bg-bg p-3">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{im.perServing}</span>
              <span className="mt-1 block text-[13px] font-semibold tabular-nums">{lines.length ? macroText(preview.macros) : "—"}</span>
            </div>

            {error ? <p role="alert" className="mt-3 text-[12.5px] font-semibold text-risk">{error}</p> : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} disabled={pending}
                className="inline-flex h-10 items-center rounded-xl px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
                {t.clientApp.recipes.cancel}
              </button>
              <button type="button" onClick={save} disabled={pending}
                className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg disabled:opacity-50">
                {pending ? im.saving : im.save}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
