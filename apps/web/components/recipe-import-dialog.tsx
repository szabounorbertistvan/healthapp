"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import {
  proposedServingGrams, recomputedServing, scaledServing, type DialogLine, type Macros,
} from "@healthapp/shared";
import { cancelRecipeImport, saveRecipeImport } from "@/app/recipe-actions";
import { searchFoods } from "@/app/nutrition-actions";
import { settle, settleRead } from "@/lib/settle-action";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { FIELD, FIELD_INSET } from "@/lib/form-classes";
import type { FoodItem } from "@/lib/food-portions";

export type ImportDialogProps = {
  title: string;
  url: string;
  image: string | null;
  servings: number;
  perServing: Macros;
  lines: { label: string; grams: number | null; food: { id: string; name: string; per100: Macros } | null }[];
  existing: { id: string; title: string }[];
};

type LineState = { food: { id: string; name: string; per100: Macros } | null; grams: number | null; include: boolean };

/**
 * The DishFinder hand-off, before it becomes one of "My recipes": the servings
 * and a serving's weight, every line with the Voinic food it points to (change
 * it, set its grams, drop it), and the nutrition of one serving — DishFinder's,
 * or recalculated from the lines once the person changed them. Saving sends
 * only the choices; the server works the numbers out again (recipe-actions.ts).
 */
export function RecipeImportDialog(props: ImportDialogProps) {
  const { t } = useI18n();
  const m = t.clientApp.recipes.import;
  const router = useRouter();
  const [title, setTitle] = useState(props.title);
  const [servings, setServings] = useState(props.servings);
  const [lines, setLines] = useState<LineState[]>(() => props.lines.map((l) => ({ food: l.food, grams: l.grams, include: true })));
  const initialGrams = useMemo(() => proposedServingGrams(props.lines.map((l) => ({ food: l.food, grams: l.grams, include: true })), props.servings), [props.lines, props.servings]);
  const [servingGrams, setServingGrams] = useState<string>(initialGrams ? String(initialGrams) : "");
  const [recompute, setRecompute] = useState(false);
  const [replaceId, setReplaceId] = useState<string | null>(props.existing[0]?.id ?? null);
  const [searchAt, setSearchAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);

  const dialogLines: DialogLine[] = lines.map((l) => ({ food: l.food ? { id: l.food.id, per100: l.food.per100 } : null, grams: l.grams, include: l.include }));
  const df = scaledServing(props.perServing, props.servings, servings);
  const re = recomputedServing(dialogLines, servings);
  const shown = recompute ? re.macros : df;

  function edit(i: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setRecompute(true);
  }

  function close() {
    start(async () => {
      await settle(() => cancelRecipeImport(), t.common.actions.unreachable);
      router.replace("/recipes");
      router.refresh();
    });
  }

  function save() {
    const g = Number(servingGrams.replace(",", "."));
    if (!(g > 0)) { setError(m.servingGramsRequired); return; }
    setError(null);
    start(async () => {
      const result = await settle(() => saveRecipeImport({
        title, servings, servingGrams: g, recompute, replaceId,
        lines: lines.map((l, position) => ({ position, foodId: l.food?.id ?? null, grams: l.grams, include: l.include })),
      }), t.common.actions.unreachable);
      if (!result.ok) { setError(result.message ?? t.clientApp.recipes.failed); return; }
      router.replace("/recipes");
      router.refresh();
    });
  }

  const macroText = (x: Macros) => `${x.kcal} kcal · P ${x.protein} g · C ${x.carbs} g · G ${x.fat} g`;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !pending) close(); }}>
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
              <Dialog.Close ref={closeRef} aria-label={m.notNow}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft hover:border-accent hover:text-ink">
                ✕
              </Dialog.Close>
            </div>

            <div className="mt-4 flex gap-3">
              {props.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- DishFinder's image host is not in next.config
                <img src={props.image} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} aria-label={t.clientApp.recipes.title}
                  className={`${FIELD} mt-0 font-semibold`} />
                <a href={props.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[12px] font-semibold text-accent-ink hover:underline">
                  {t.clientApp.recipes.openDishfinder} ↗
                </a>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[12.5px] font-semibold text-ink-soft">
                {m.servings}
                <span className="mt-1 flex items-center gap-2">
                  <input type="number" min={1} max={500} step="1" value={servings}
                    onChange={(e) => { const n = Number(e.target.value); if (n > 0) setServings(n); }}
                    className={`${FIELD} mt-0 w-24 tabular-nums`} />
                  <span className="font-normal text-ink-faint">{m.servingsUnit}</span>
                </span>
              </label>
              <label className="text-[12.5px] font-semibold text-ink-soft">
                {m.servingGrams}
                <span className="mt-1 flex items-center gap-2">
                  <input inputMode="decimal" value={servingGrams} onChange={(e) => setServingGrams(e.target.value)}
                    className={`${FIELD} mt-0 w-24 tabular-nums`} />
                  <span className="font-normal text-ink-faint">{m.grams}</span>
                </span>
                <span className="mt-1 block text-[11.5px] font-normal text-ink-faint">{initialGrams ? m.proposed : m.noProposal}</span>
              </label>
            </div>

            <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{m.ingredients}</p>
            <ul className="mt-2 divide-y divide-line/60">
              {props.lines.map((orig, i) => {
                const l = lines[i]!;
                return (
                  <li key={i} className={`py-2.5 ${l.include ? "" : "opacity-50"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-[13px]">{orig.label}</span>
                      <input inputMode="decimal" aria-label={`${orig.label} — ${m.grams}`} value={l.grams ?? ""} disabled={!l.include}
                        onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); edit(i, { grams: e.target.value.trim() === "" ? null : n > 0 ? n : l.grams }); }}
                        className={`${FIELD} mt-0 h-9 w-20 tabular-nums`} placeholder={m.grams} />
                      <button type="button" onClick={() => edit(i, { include: !l.include })}
                        className="rounded-lg px-2 py-1 text-[12px] font-semibold text-ink-faint hover:text-ink">
                        {l.include ? m.remove : m.restore}
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                      {l.food ? (
                        <span className="text-ink-soft">→ <b className="font-semibold text-ink">{l.food.name}</b>{orig.food && orig.food.id === l.food.id ? ` · ${m.linked}` : ""}</span>
                      ) : null}
                      {l.include ? (
                        <button type="button" onClick={() => setSearchAt(searchAt === i ? null : i)}
                          className="font-semibold text-accent-ink hover:underline">
                          {l.food ? m.change : m.choose}
                        </button>
                      ) : null}
                    </div>
                    {searchAt === i ? (
                      <FoodSearch
                        placeholder={m.searchPlaceholder}
                        empty={m.noResults}
                        onPick={(f) => { edit(i, { food: { id: f.id, name: f.name_ro || f.name_en, per100: f.per_100g } }); setSearchAt(null); }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[{ on: !recompute, label: m.fromDishfinder, value: df, set: () => setRecompute(false), choose: m.useDishfinder },
                { on: recompute, label: m.recalculated, value: re.macros, set: () => setRecompute(true), choose: m.useRecalculated }].map((o) => (
                <button key={o.label} type="button" onClick={o.set} aria-pressed={o.on}
                  className={`rounded-2xl p-3 text-left ${o.on ? "bg-accent-soft ring-1 ring-accent" : "bg-bg hover:bg-accent-soft/40"}`}>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{o.label} · {m.perServing}</span>
                  <span className="mt-1 block text-[13px] font-semibold tabular-nums">{macroText(o.value)}</span>
                  <span className="mt-1 block text-[11.5px] text-ink-faint">{o.choose}</span>
                </button>
              ))}
            </div>
            {recompute && re.missing > 0 ? <p className="mt-2 text-[12px] text-warn">{fill(m.missing, { n: re.missing })}</p> : null}

            {props.existing.length > 0 ? (
              <fieldset className="mt-4 rounded-2xl bg-bg p-3">
                <legend className="px-1 text-[12.5px] font-semibold text-ink-soft">{m.existing}</legend>
                {props.existing.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 py-1 text-[13px]">
                    <input type="radio" name="replace" checked={replaceId === e.id} onChange={() => setReplaceId(e.id)} />
                    {m.replace}: <b className="font-semibold">{e.title}</b>
                  </label>
                ))}
                <label className="flex items-center gap-2 py-1 text-[13px]">
                  <input type="radio" name="replace" checked={replaceId === null} onChange={() => setReplaceId(null)} />
                  {m.copy}
                </label>
              </fieldset>
            ) : null}

            {error ? <p role="alert" className="mt-3 text-[12.5px] font-semibold text-risk">{error}</p> : null}
            <p className="mt-2 text-[12px] text-ink-faint tabular-nums">{macroText(shown)} · {m.perServing}</p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={close} disabled={pending}
                className="inline-flex h-10 items-center rounded-xl px-4 text-[13px] font-semibold text-ink-soft hover:text-ink disabled:opacity-50">
                {m.notNow}
              </button>
              <button type="button" onClick={save} disabled={pending}
                className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-accent-fg disabled:opacity-50">
                {pending ? m.saving : m.save}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One line's food search: Enter or the button asks, so typing does not burn the daily search quota. */
export function FoodSearch({ placeholder, empty, onPick }: { placeholder: string; empty: string; onPick: (f: FoodItem) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoodItem[] | null>(null);
  const [pending, start] = useTransition();
  function run() {
    if (q.trim().length < 2) return;
    start(async () => {
      const items = await settleRead(() => searchFoods(q));
      setFound((items ?? []).slice(0, 8));
    });
  }
  return (
    <div className="mt-2 rounded-xl bg-bg p-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus
          className={`${FIELD_INSET} mt-0 h-9 flex-1`} />
        <button type="submit" disabled={pending} className="rounded-lg bg-surface px-3 text-[12px] font-semibold disabled:opacity-50">⌕</button>
      </form>
      {found ? (
        found.length === 0 ? <p className="mt-2 text-[12px] text-ink-faint">{empty}</p> : (
          <ul className="mt-2 space-y-1">
            {found.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => onPick(f)}
                  className="flex w-full justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-surface">
                  <span className="truncate">{f.name_ro || f.name_en}</span>
                  <span className="shrink-0 tabular-nums text-ink-faint">{Math.round(f.per_100g.kcal)} kcal/100 g</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
