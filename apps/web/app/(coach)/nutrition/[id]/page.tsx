import Link from "next/link";
import { notFound } from "next/navigation";
import { getNutritionPlan } from "@/lib/data";
import { getMyRecipes } from "@/lib/recipes-data";
import { NavIcon } from "@/components/client-nav";
import { NutritionBuilder } from "@/components/nutrition-builder";
import { getI18n } from "@/lib/i18n/server";
import { canEdit } from "@/lib/can-edit";
import { ReadOnlyNotice } from "@/components/read-only-notice";

export default async function NutritionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  // The editor's own recipes: the only ones a meal can link (planned_meals_guard, 20261204100000).
  const [plan, access, recipes] = await Promise.all([
    getNutritionPlan(id),
    canEdit("can_edit_nutrition_plan", { p_plan: id }),
    getMyRecipes(),
  ]);
  if (!plan) notFound();
  // The back label ships with its own arrow glyph; the chevron icon replaces it.

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/nutrition"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-accent-ink"
      >
        <NavIcon d="m15 6-6 6 6 6" className="h-3.5 w-3.5" />
        {t.coachApp.nutrition.back}
      </Link>
      <h1 className="mt-3 font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">
        {plan.name}
      </h1>
      {access === "edit" ? null
        : <ReadOnlyNotice text={access === "read-only" ? t.coachApp.nutrition.readOnly : t.common.actions.editUnverified} />}
      {/* editable only on a confirmed yes (lib/edit-access.ts) */}
      <fieldset disabled={access !== "edit"} className="mt-5 min-w-0 sm:mt-6">
        <NutritionBuilder plan={plan} recipes={recipes.map((r) => ({ id: r.id, title: r.title }))} />
      </fieldset>
    </div>
  );
}
