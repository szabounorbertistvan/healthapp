"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n";
import { settle } from "@/lib/settle-action";
import { RECIPES_TIP_KEY, type Audience } from "@/lib/onboarding-model";
import { snoozeRecipesTip } from "@/app/onboarding-actions";
import { NavIcon } from "@/components/client-nav";
import { DishFinderMark } from "@/components/dishfinder-mark";
import { useOnboarding } from "./provider";

/**
 * "Have you found the DishFinder recipes?" — on Today (client) and the
 * dashboard (coach), for everyone who has not opened them yet. The server
 * decides whether it renders (shouldShowRecipesTip); this decides nothing but
 * how it goes away:
 *
 *   Discover recipes   opens DishFinder's finder in a new tab  → done
 *   Got it             after reading the steps                 → done
 *   ×                  "Don't show this again"                 → dismissed
 *   Later              a cookie, this device, 7 days; no mark
 *
 * Any meal's own DishFinder link marks it done too (meal-card.tsx), so someone
 * who found the links alone is not told about them. The steps unfold in place
 * — no dialog, nothing made inert, the page stays usable.
 */
export function RecipesCard({ audience, url }: { audience: Audience; url: string }) {
  const { t } = useI18n();
  const r = t.onboarding.recipes;
  const names = { nutrition: t.common.nav.nutrition, myTraining: t.common.nav.myTraining };
  const { state, mark } = useOnboarding();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const stepsId = useId();
  // marked in another tab, or by a meal link on this one
  if (hidden || (state && state[RECIPES_TIP_KEY] !== undefined)) return null;

  const finish = (how: "done" | "dismissed") => {
    setHidden(true);
    void mark(RECIPES_TIP_KEY, how);
  };

  return (
    <section aria-labelledby={titleId} className="glass rounded-3xl px-5 py-4">
      <div className="flex items-start gap-3.5">
        <span aria-hidden className="hidden h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-ink sm:grid">
          <DishFinderMark className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{r.eyebrow}</p>
          <h2 id={titleId} className="mt-0.5 font-display text-[15px] font-bold tracking-tight">{r.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            {fill(audience === "coach" ? r.coachBody : r.body, names)}
          </p>
        </div>
        <button
          type="button"
          aria-label={r.close}
          title={r.close}
          onClick={() => finish("dismissed")}
          className="-mr-1.5 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint outline-none ring-accent/50 hover:bg-bg hover:text-ink focus-visible:ring-2"
        >
          <NavIcon d="M6 6l12 12M18 6 6 18" className="h-4 w-4" />
        </button>
      </div>

      {open ? (
        <ol id={stepsId} aria-label={r.stepsLabel} className="mt-4 space-y-3 border-t border-line/60 pt-4">
          {r.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent-ink">
                {i + 1}
              </span>
              <div className="min-w-0 text-[13px] leading-relaxed">
                <p className="font-semibold">{fill(s.title, names)}</p>
                <p className="text-ink-soft">
                  {fill(i === 0 ? (audience === "coach" ? r.step1Coach : r.step1Client) : s.body, names)}
                </p>
                {i === 0 ? (
                  <Link href="/food" className="mt-1 inline-block font-semibold text-accent-ink underline-offset-2 hover:underline">
                    {fill(r.openNutrition, names)} →
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            // the link must still be on the page when the browser follows it
            window.setTimeout(() => finish("done"), 0);
          }}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl bg-accent px-4 font-display text-[13.5px] font-bold text-accent-fg outline-none ring-accent/50 ring-offset-2 ring-offset-surface hover:opacity-90 focus-visible:ring-2"
        >
          <DishFinderMark />
          {r.discover} <span aria-hidden>↗</span>
          <span className="sr-only">({r.newTab})</span>
        </a>
        {open ? (
          <button
            type="button"
            onClick={() => finish("done")}
            className="inline-flex h-10 items-center justify-center rounded-2xl bg-bg px-4 text-[13px] font-semibold text-ink outline-none ring-accent/50 hover:text-accent-ink focus-visible:ring-2"
          >
            {r.done}
          </button>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? stepsId : undefined}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-10 items-center justify-center rounded-2xl px-3.5 text-[13px] font-semibold text-ink-soft outline-none ring-accent/50 hover:bg-bg hover:text-ink focus-visible:ring-2"
        >
          {open ? r.hideHow : r.how}
        </button>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            void settle(() => snoozeRecipesTip(), "unreachable");
          }}
          className="inline-flex h-10 items-center justify-center rounded-2xl px-3.5 text-[13px] font-semibold text-ink-soft outline-none ring-accent/50 hover:bg-bg hover:text-ink focus-visible:ring-2"
        >
          {r.later}
        </button>
      </div>
    </section>
  );
}
