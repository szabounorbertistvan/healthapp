import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { getMySoloPlan, hasActiveCoach } from "@/lib/client-data";
import { getNutritionPlan } from "@/lib/data";
import { getMyRecipes } from "@/lib/recipes-data";
import { canEdit } from "@/lib/can-edit";
import { NavIcon } from "@/components/client-nav";
import { NutritionBuilder } from "@/components/nutrition-builder";
import { StartMealPlanButton } from "@/components/start-meal-plan";
import { ReadOnlyNotice } from "@/components/read-only-notice";

/**
 * A person's own meal plan — the coach's builder on their own targets plan
 * (nutrition_plans with coach_id null). The same week, totals, extra meals and
 * linked recipes; no publishing, since the plan is already the one their diary
 * shows. While a coach is active, the coach's plan is the one that applies
 * (pickProgram), so this page says so instead of offering a plan nobody reads.
 */
export default async function MyMealPlanPage() {
  const { t } = await getI18n();
  const m = t.clientApp.mealPlan;
  const [coached, solo] = await Promise.all([hasActiveCoach(), getMySoloPlan()]);
  const [plan, access, recipes] = solo?.hasMeals && !coached
    ? await Promise.all([getNutritionPlan(solo.id), canEdit("can_edit_nutrition_plan", { p_plan: solo.id }), getMyRecipes()])
    : [null, null, []];

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link href="/food" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink">
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.common.nav.nutrition}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{m.title}</h1>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">{m.intro}</p>

      <div className="mt-5 sm:mt-6">
        {coached ? (
          <p className="max-w-2xl rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-soft">{m.coachActive}</p>
        ) : !solo ? (
          <p className="max-w-2xl rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-soft">
            {m.noTargets}{" "}
            <Link href="/food" className="font-semibold text-accent-ink hover:underline">{m.setTargets}</Link>
          </p>
        ) : !solo.hasMeals ? (
          <StartMealPlanButton />
        ) : plan ? (
          <>
            {access === "edit" ? null : <ReadOnlyNotice text={t.common.actions.editUnverified} />}
            <fieldset disabled={access !== "edit"} className="min-w-0">
              <NutritionBuilder plan={plan} solo recipes={recipes.map((r) => ({ id: r.id, title: r.title }))} />
            </fieldset>
          </>
        ) : null}
      </div>
    </div>
  );
}
